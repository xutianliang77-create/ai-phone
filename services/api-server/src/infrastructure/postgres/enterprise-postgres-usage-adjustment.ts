import { createHash, randomUUID } from "node:crypto";
import type {
  AdjustEnterpriseUsageInput,
  AdjustEnterpriseUsageResult,
} from "../../modules/enterprise/enterprise-usage-accounting.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  mapEnterpriseUsageAdjustment,
  type EnterpriseUsageAccountingRow,
} from "./enterprise-postgres-usage-accounting-record.js";
import { enterprisePostgresActorSubjectId } from "./enterprise-postgres-subject-id.js";

export class EnterpriseUsageAdjustmentPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async adjust(
    input: AdjustEnterpriseUsageInput,
  ): Promise<AdjustEnterpriseUsageResult> {
    const normalized = normalize(input);
    await this.session.queryTenantRecord(
      "SELECT id FROM enterprise.tenants WHERE id = $1 FOR UPDATE",
    );
    const replay = await this.session.query<EnterpriseUsageAccountingRow>(`
      SELECT * FROM enterprise.usage_adjustments
      WHERE tenant_id = $1 AND idempotency_key = $2 FOR UPDATE
    `, [normalized.idempotencyKey]);
    if (replay.rows[0]) {
      const adjustment = mapEnterpriseUsageAdjustment(
        replay.rows[0],
        this.session.context.tenantId,
      );
      return adjustment.requestHash === normalized.requestHash
        ? { status: "replayed", adjustment }
        : { status: "idempotency_conflict" };
    }
    const targetResult = await this.session.query<TargetLedgerRow>(`
      SELECT id, billing_account_id, budget_id, category, unit, amount,
        entry_type, occurred_at
      FROM enterprise.usage_ledger
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE
    `, [normalized.targetLedgerEntryId]);
    const target = targetResult.rows[0];
    if (!target) return { status: "not_found" };
    if (target.entry_type !== "settle") return { status: "target_not_settlement" };
    const priorResult = await this.session.query<{ amount: unknown }>(`
      SELECT COALESCE(sum(delta_amount), 0)::text AS amount
      FROM enterprise.usage_adjustments
      WHERE tenant_id = $1 AND target_ledger_entry_id = $2
    `, [normalized.targetLedgerEntryId]);
    const targetAmount = safeInteger(target.amount, "target amount");
    const priorAmount = safeInteger(priorResult.rows[0]?.amount ?? 0, "prior amount");
    if (targetAmount + priorAmount + normalized.deltaAmount < 0) {
      return { status: "negative_net" };
    }
    const adjustmentId = randomUUID();
    const ledgerId = randomUUID();
    const accountId = required(target.billing_account_id, "billing account");
    const occurredAt = timestamp(target.occurred_at, "occurred at");
    const category = required(target.category, "category");
    const unit = required(target.unit, "unit");
    await this.session.query(`
      INSERT INTO enterprise.usage_ledger(
        id, tenant_id, category, amount, unit, source_type, source_id,
        idempotency_key, occurred_at, metadata, entry_type, budget_id,
        hold_id, source_ref, request_hash, recorded_at,
        billing_account_id, usage_event_id
      ) VALUES (
        $2, $1, $3, $4, $5, 'billing_adjustment', NULL, $6, $7,
        $8::jsonb, 'adjustment', $9, NULL, $10, $11, $12, $13, NULL
      ) RETURNING id
    `, [
      ledgerId,
      category,
      normalized.deltaAmount,
      unit,
      `usage-adjustment:${normalized.idempotencyKey}`,
      occurredAt,
      JSON.stringify({
        targetLedgerEntryId: normalized.targetLedgerEntryId,
        reasonCode: normalized.reasonCode,
      }),
      target.budget_id ?? null,
      adjustmentId,
      normalized.requestHash,
      normalized.now,
      accountId,
    ]);
    const inserted = await this.session.query<EnterpriseUsageAccountingRow>(`
      INSERT INTO enterprise.usage_adjustments(
        tenant_id, id, billing_account_id, target_ledger_entry_id,
        adjustment_ledger_entry_id, delta_amount, reason_code,
        idempotency_key, request_hash, actor_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      adjustmentId,
      accountId,
      normalized.targetLedgerEntryId,
      ledgerId,
      normalized.deltaAmount,
      normalized.reasonCode,
      normalized.idempotencyKey,
      normalized.requestHash,
      enterprisePostgresActorSubjectId(this.session.context.actorUserId),
      normalized.now,
    ]);
    return {
      status: "adjusted",
      adjustment: mapEnterpriseUsageAdjustment(
        inserted.rows[0]!,
        this.session.context.tenantId,
      ),
    };
  }
}

interface TargetLedgerRow extends Record<string, unknown> {
  billing_account_id: unknown;
  budget_id: unknown;
  category: unknown;
  unit: unknown;
  amount: unknown;
  entry_type: unknown;
  occurred_at: unknown;
}

function normalize(input: AdjustEnterpriseUsageInput) {
  const now = input.now ?? new Date();
  if (!uuid(input.targetLedgerEntryId) || !Number.isSafeInteger(input.deltaAmount) ||
    input.deltaAmount === 0 || !/^[a-z][a-z0-9_.-]{1,79}$/.test(input.reasonCode) ||
    !text(input.idempotencyKey, 200) || !Number.isFinite(now.getTime())) {
    throw new Error("Invalid enterprise usage adjustment");
  }
  const normalized = {
    targetLedgerEntryId: input.targetLedgerEntryId.toLowerCase(),
    deltaAmount: input.deltaAmount,
    reasonCode: input.reasonCode,
    idempotencyKey: input.idempotencyKey.trim(),
    now: now.toISOString(),
  };
  return {
    ...normalized,
    requestHash: createHash("sha256").update(JSON.stringify({
      targetLedgerEntryId: normalized.targetLedgerEntryId,
      deltaAmount: normalized.deltaAmount,
      reasonCode: normalized.reasonCode,
    })).digest("hex"),
  };
}
function safeInteger(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid ${field}`);
  return parsed;
}
function required(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${field}`);
  return value.trim();
}
function timestamp(value: unknown, field: string) {
  const parsed = value instanceof Date ? value.toISOString() : required(value, field);
  if (!Number.isFinite(Date.parse(parsed))) throw new Error(`Invalid ${field}`);
  return parsed;
}
function text(value: string, max: number) {
  return Boolean(value.trim()) && Buffer.byteLength(value) <= max;
}
function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}
