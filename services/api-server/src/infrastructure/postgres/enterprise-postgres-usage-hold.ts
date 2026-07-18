import { randomUUID } from "node:crypto";
import type {
  HoldEnterpriseUsageInput,
  HoldEnterpriseUsageResult,
  SettleEnterpriseUsageInput,
  SettleEnterpriseUsageResult,
} from "../../modules/enterprise/enterprise-usage-budget.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  mapEnterpriseUsageBudgetRow,
  mapEnterpriseUsageHoldRow,
  type EnterpriseUsageBudgetRow,
  type EnterpriseUsageHoldRow,
} from "./enterprise-postgres-usage-budget-record.js";
import {
  EnterpriseUsageEventPostgresRepository,
} from "./enterprise-postgres-usage-event.js";

export class EnterpriseUsageHoldPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async hold(input: HoldEnterpriseUsageInput): Promise<HoldEnterpriseUsageResult> {
    const normalized = normalizeHold(input);
    await this.lockTenant();
    const replay = await this.session.query<EnterpriseUsageHoldRow>(`
      SELECT * FROM enterprise.usage_holds
      WHERE tenant_id = $1 AND idempotency_key = $2 FOR UPDATE
    `, [normalized.idempotencyKey]);
    if (replay.rows[0]) {
      const hold = mapEnterpriseUsageHoldRow(
        replay.rows[0],
        this.session.context.tenantId,
      );
      return hold.requestHash === normalized.requestHash
        ? { status: "replayed", hold }
        : { status: "idempotency_conflict" };
    }
    const budgetResult = await this.session.query<EnterpriseUsageBudgetRow>(`
      SELECT * FROM enterprise.usage_budgets
      WHERE tenant_id = $1 AND category = $2 AND unit = $3
        AND period_start <= $4 AND period_end > $4
      ORDER BY period_start DESC LIMIT 1 FOR UPDATE
    `, [normalized.category, normalized.unit, normalized.now]);
    if (!budgetResult.rows[0]) return { status: "budget_not_configured" };
    const budget = mapEnterpriseUsageBudgetRow(
      budgetResult.rows[0],
      this.session.context.tenantId,
    );
    if (budget.status !== "active") return { status: "budget_paused" };
    await this.session.query(`
      UPDATE enterprise.usage_holds
      SET status = 'expired', released_at = $3, updated_at = $3,
        version = version + 1
      WHERE tenant_id = $1 AND budget_id = $2 AND status = 'held'
        AND expires_at <= $3 RETURNING id
    `, [budget.id, normalized.now]);
    const used = await this.sum(`
      SELECT COALESCE(sum(amount), 0)::text AS amount
      FROM enterprise.usage_ledger
      WHERE tenant_id = $1 AND budget_id = $2 AND entry_type = 'settle'
    `, [budget.id]);
    const held = await this.sum(`
      SELECT COALESCE(sum(amount), 0)::text AS amount
      FROM enterprise.usage_holds
      WHERE tenant_id = $1 AND budget_id = $2 AND status = 'held'
        AND expires_at > $3
    `, [budget.id, normalized.now]);
    if (used + held + normalized.amount > budget.limitAmount) {
      return {
        status: "budget_exhausted",
        used,
        held,
        limit: budget.limitAmount,
      };
    }
    const inserted = await this.session.query<EnterpriseUsageHoldRow>(`
      INSERT INTO enterprise.usage_holds(
        tenant_id, id, billing_account_id, budget_id, category, unit, amount, status,
        source_type, source_ref, idempotency_key, request_hash,
        held_at, expires_at, updated_at, version
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, 'held', $8, $9, $10, $11,
        $12, $13, $12, 1
      ) RETURNING *
    `, [
      randomUUID(),
      budget.billingAccountId,
      budget.id,
      normalized.category,
      normalized.unit,
      normalized.amount,
      normalized.sourceType,
      normalized.sourceRef,
      normalized.idempotencyKey,
      normalized.requestHash,
      normalized.now,
      normalized.expiresAt,
    ]);
    await this.insertAlert(budget, used + held + normalized.amount, normalized.now);
    return {
      status: "created",
      hold: mapEnterpriseUsageHoldRow(
        inserted.rows[0]!,
        this.session.context.tenantId,
      ),
    };
  }

  async settle(
    input: SettleEnterpriseUsageInput,
  ): Promise<SettleEnterpriseUsageResult> {
    const normalized = normalizeSettle(input);
    await this.lockTenant();
    const replay = await this.session.query<LedgerReplayRow>(`
      SELECT hold_id, amount, request_hash
      FROM enterprise.usage_ledger
      WHERE tenant_id = $1 AND idempotency_key = $2 FOR UPDATE
    `, [normalized.idempotencyKey]);
    if (replay.rows[0]) {
      const exact = String(replay.rows[0].hold_id) === normalized.holdId &&
        Number(replay.rows[0].amount) === normalized.amount &&
        replay.rows[0].request_hash === normalized.requestHash;
      if (!exact) return { status: "idempotency_conflict" };
      const hold = await this.findHold(normalized.holdId);
      return hold ? { status: "replayed", hold } : { status: "not_found" };
    }
    const hold = await this.findHold(normalized.holdId);
    if (!hold) return { status: "not_found" };
    if (hold.status !== "held" || Date.parse(hold.expiresAt) <= Date.parse(normalized.now)) {
      return { status: "hold_not_active" };
    }
    if (normalized.amount > hold.amount) return { status: "amount_exceeds_hold" };
    const event = await new EnterpriseUsageEventPostgresRepository(
      this.session,
    ).recordSettlement({
      billingAccountId: hold.billingAccountId,
      budgetId: hold.budgetId,
      holdId: hold.id,
      category: hold.category,
      unit: hold.unit,
      amount: normalized.amount,
      sourceType: hold.sourceType,
      sourceRef: hold.sourceRef,
      idempotencyKey: normalized.idempotencyKey,
      requestHash: normalized.requestHash,
      occurredAt: normalized.occurredAt,
      metadata: normalized.metadata,
      now: new Date(normalized.now),
    });
    if (event.status === "idempotency_conflict") {
      return { status: "idempotency_conflict" };
    }
    if (event.status === "billing_account_unavailable") {
      throw new Error("Enterprise usage billing account unavailable");
    }
    const updated = await this.session.query<EnterpriseUsageHoldRow>(`
      UPDATE enterprise.usage_holds
      SET status = 'settled', settled_amount = $3, settled_at = $4,
        updated_at = $4, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'held'
      RETURNING *
    `, [hold.id, normalized.amount, normalized.now]);
    if (!updated.rows[0]) throw new Error("Enterprise usage hold settlement conflict");
    return {
      status: "settled",
      hold: mapEnterpriseUsageHoldRow(
        updated.rows[0],
        this.session.context.tenantId,
      ),
    };
  }

  private lockTenant() {
    return this.session.queryTenantRecord(
      "SELECT id FROM enterprise.tenants WHERE id = $1 FOR UPDATE",
    );
  }

  private async findHold(id: string) {
    const result = await this.session.query<EnterpriseUsageHoldRow>(`
      SELECT * FROM enterprise.usage_holds
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE
    `, [id]);
    return result.rows[0] ? mapEnterpriseUsageHoldRow(
      result.rows[0],
      this.session.context.tenantId,
    ) : null;
  }

  private async sum(sql: string, values: unknown[]) {
    const result = await this.session.query<{ amount: unknown }>(sql, values);
    const amount = Number(result.rows[0]?.amount ?? 0);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error("Invalid enterprise usage aggregate");
    }
    return amount;
  }

  private insertAlert(
    budget: ReturnType<typeof mapEnterpriseUsageBudgetRow>,
    projectedAmount: number,
    now: string,
  ) {
    if (projectedAmount * 100 <
      budget.limitAmount * budget.alertThresholdPercent) return Promise.resolve();
    return this.session.query(`
      INSERT INTO enterprise.usage_budget_alerts(
        tenant_id, id, budget_id, threshold_percent,
        projected_amount, limit_amount, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (tenant_id, budget_id, threshold_percent) DO NOTHING
      RETURNING id
    `, [
      randomUUID(),
      budget.id,
      budget.alertThresholdPercent,
      projectedAmount,
      budget.limitAmount,
      now,
    ]);
  }
}

interface LedgerReplayRow extends Record<string, unknown> {
  hold_id: unknown;
  amount: unknown;
  request_hash: unknown;
}

function normalizeHold(input: HoldEnterpriseUsageInput) {
  const now = input.now ?? new Date();
  if (!Number.isSafeInteger(input.amount) || input.amount < 1 ||
    !text(input.sourceType, 80) || !text(input.sourceRef, 200) ||
    !text(input.idempotencyKey, 200) || !hash(input.requestHash) ||
    !Number.isFinite(Date.parse(input.expiresAt)) ||
    Date.parse(input.expiresAt) <= now.getTime()) {
    throw new Error("Invalid enterprise usage hold");
  }
  return { ...input, now: now.toISOString(), expiresAt: new Date(input.expiresAt).toISOString() };
}

function normalizeSettle(input: SettleEnterpriseUsageInput) {
  const now = input.now ?? new Date();
  if (!text(input.holdId, 200) || !Number.isSafeInteger(input.amount) ||
    input.amount < 0 || !text(input.idempotencyKey, 200) ||
    !hash(input.requestHash) || !Number.isFinite(Date.parse(input.occurredAt)) ||
    Date.parse(input.occurredAt) > now.getTime() + 60_000) {
    throw new Error("Invalid enterprise usage settlement");
  }
  return {
    ...input,
    now: now.toISOString(),
    occurredAt: new Date(input.occurredAt).toISOString(),
    metadata: input.metadata ?? {},
  };
}
function text(value: string, max: number) {
  return value.trim() && Buffer.byteLength(value) <= max;
}
function hash(value: string) {
  return /^[a-f0-9]{64}$/.test(value);
}
