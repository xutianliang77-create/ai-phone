import { createHash, randomUUID } from "node:crypto";
import {
  isEnterpriseUsageCategory,
  isEnterpriseUsageUnit,
} from "@translation/contracts";
import type {
  EnterpriseUsagePeriodAggregateRecord,
  RebuildEnterpriseUsagePeriodInput,
  RebuildEnterpriseUsagePeriodResult,
} from "../../modules/enterprise/enterprise-usage-accounting.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  mapEnterpriseUsagePeriodAggregate,
  type EnterpriseUsageAccountingRow,
} from "./enterprise-postgres-usage-accounting-record.js";

export class EnterpriseUsageAggregatePostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async rebuild(
    input: RebuildEnterpriseUsagePeriodInput,
  ): Promise<RebuildEnterpriseUsagePeriodResult> {
    const normalized = normalize(input);
    await this.session.queryTenantRecord(
      "SELECT id FROM enterprise.tenants WHERE id = $1 FOR UPDATE",
    );
    const accountResult = await this.session.query<{ id: string }>(`
      SELECT id FROM enterprise.billing_accounts
      WHERE tenant_id = $1 FOR UPDATE
    `);
    const accountId = accountResult.rows[0]?.id;
    if (!accountId) return { status: "billing_account_unavailable" };
    const existingResult = await this.session.query<EnterpriseUsageAccountingRow>(`
      SELECT * FROM enterprise.usage_period_aggregates
      WHERE tenant_id = $1 AND billing_account_id = $2
        AND category = $3 AND unit = $4
        AND period_start = $5 AND period_end = $6 FOR UPDATE
    `, [
      accountId,
      normalized.category,
      normalized.unit,
      normalized.periodStart,
      normalized.periodEnd,
    ]);
    const existing = existingResult.rows[0]
      ? mapEnterpriseUsagePeriodAggregate(
          existingResult.rows[0],
          this.session.context.tenantId,
        )
      : null;
    if (normalized.expectedVersion !== undefined &&
      normalized.expectedVersion !== existing?.version) {
      return { status: "conflict" };
    }
    const ledgerResult = await this.session.query<LedgerAggregateRow>(`
      SELECT id, entry_type, amount, request_hash, recorded_at, usage_event_id
      FROM enterprise.usage_ledger
      WHERE tenant_id = $1 AND billing_account_id = $2
        AND category = $3 AND unit = $4
        AND occurred_at >= $5 AND occurred_at < $6
      ORDER BY occurred_at, id
    `, [
      accountId,
      normalized.category,
      normalized.unit,
      normalized.periodStart,
      normalized.periodEnd,
    ]);
    const values = aggregate(ledgerResult.rows);
    const row = existing
      ? await this.update(existing, values, normalized.computedAt)
      : await this.insert({
          accountId,
          ...normalized,
          ...values,
        });
    return {
      status: "rebuilt",
      aggregate: mapEnterpriseUsagePeriodAggregate(
        row,
        this.session.context.tenantId,
      ),
    };
  }

  async list(): Promise<EnterpriseUsagePeriodAggregateRecord[]> {
    const result = await this.session.query<EnterpriseUsageAccountingRow>(`
      SELECT * FROM enterprise.usage_period_aggregates
      WHERE tenant_id = $1
      ORDER BY period_start DESC, category, unit, id
    `);
    return result.rows.map((row) => mapEnterpriseUsagePeriodAggregate(
      row,
      this.session.context.tenantId,
    ));
  }

  private async insert(
    input: ReturnType<typeof normalize> & AggregateValues & { accountId: string },
  ) {
    const result = await this.session.query<EnterpriseUsageAccountingRow>(`
      INSERT INTO enterprise.usage_period_aggregates(
        tenant_id, id, billing_account_id, category, unit,
        period_start, period_end, settled_amount, adjustment_amount,
        net_amount, settlement_count, usage_event_count, adjustment_count,
        ledger_count,
        ledger_hash, source_watermark, computed_at, version
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, 1
      ) RETURNING *
    `, [
      randomUUID(),
      input.accountId,
      input.category,
      input.unit,
      input.periodStart,
      input.periodEnd,
      input.settledAmount,
      input.adjustmentAmount,
      input.netAmount,
      input.settlementCount,
      input.usageEventCount,
      input.adjustmentCount,
      input.ledgerCount,
      input.ledgerHash,
      input.sourceWatermark ?? null,
      input.computedAt,
    ]);
    return result.rows[0]!;
  }

  private async update(
    current: EnterpriseUsagePeriodAggregateRecord,
    values: AggregateValues,
    computedAt: string,
  ) {
    const result = await this.session.query<EnterpriseUsageAccountingRow>(`
      UPDATE enterprise.usage_period_aggregates
      SET settled_amount = $3, adjustment_amount = $4, net_amount = $5,
        settlement_count = $6, usage_event_count = $7,
        adjustment_count = $8, ledger_count = $9,
        ledger_hash = $10, source_watermark = $11, computed_at = $12,
        version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $13
      RETURNING *
    `, [
      current.id,
      values.settledAmount,
      values.adjustmentAmount,
      values.netAmount,
      values.settlementCount,
      values.usageEventCount,
      values.adjustmentCount,
      values.ledgerCount,
      values.ledgerHash,
      values.sourceWatermark ?? null,
      computedAt,
      current.version,
    ]);
    if (!result.rows[0]) throw new Error("Enterprise usage aggregate conflict");
    return result.rows[0];
  }
}

interface LedgerAggregateRow extends Record<string, unknown> {
  id: unknown;
  entry_type: unknown;
  amount: unknown;
  request_hash: unknown;
  recorded_at: unknown;
  usage_event_id: unknown;
}
interface AggregateValues {
  settledAmount: number;
  adjustmentAmount: number;
  netAmount: number;
  settlementCount: number;
  usageEventCount: number;
  adjustmentCount: number;
  ledgerCount: number;
  ledgerHash: string;
  sourceWatermark?: string;
}

function aggregate(rows: LedgerAggregateRow[]): AggregateValues {
  let settledAmount = 0;
  let adjustmentAmount = 0;
  let settlementCount = 0;
  let usageEventCount = 0;
  let adjustmentCount = 0;
  let sourceWatermark: string | undefined;
  const digest = createHash("sha256");
  for (const row of rows) {
    const type = required(row.entry_type, "entry type");
    const amount = integer(row.amount, "amount");
    if (type === "settle") {
      settledAmount = add(settledAmount, amount);
      settlementCount += 1;
      if (row.usage_event_id !== null && row.usage_event_id !== undefined) {
        required(row.usage_event_id, "usage event id");
        usageEventCount += 1;
      }
    } else if (type === "adjustment") {
      adjustmentAmount = add(adjustmentAmount, amount);
      adjustmentCount += 1;
    } else throw new Error("Invalid enterprise usage ledger entry type");
    const recordedAt = timestamp(row.recorded_at, "recorded at");
    if (!sourceWatermark || recordedAt > sourceWatermark) sourceWatermark = recordedAt;
    for (const value of [row.id, type, String(amount), row.request_hash, recordedAt]) {
      const part = required(value, "ledger hash input");
      digest.update(String(Buffer.byteLength(part))).update(":").update(part);
    }
  }
  const netAmount = add(settledAmount, adjustmentAmount);
  if (settledAmount < 0 || netAmount < 0) {
    throw new Error("Invalid enterprise usage aggregate total");
  }
  return {
    settledAmount,
    adjustmentAmount,
    netAmount,
    settlementCount,
    usageEventCount,
    adjustmentCount,
    ledgerCount: rows.length,
    ledgerHash: digest.digest("hex"),
    ...(sourceWatermark ? { sourceWatermark } : {}),
  };
}

function normalize(input: RebuildEnterpriseUsagePeriodInput) {
  const now = input.now ?? new Date();
  const periodStart = timestamp(input.periodStart, "period start");
  const periodEnd = timestamp(input.periodEnd, "period end");
  if (!isEnterpriseUsageCategory(input.category) ||
    !isEnterpriseUsageUnit(input.unit) ||
    Date.parse(periodEnd) <= Date.parse(periodStart) ||
    !Number.isFinite(now.getTime()) ||
    input.expectedVersion !== undefined &&
      (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    throw new Error("Invalid enterprise usage aggregate request");
  }
  return {
    ...input,
    periodStart,
    periodEnd,
    computedAt: now.toISOString(),
  };
}
function add(left: number, right: number) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("Usage aggregate overflow");
  return result;
}
function integer(value: unknown, field: string) {
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
  return new Date(parsed).toISOString();
}
