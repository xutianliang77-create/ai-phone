import {
  isEnterpriseUsageCategory,
  isEnterpriseUsageUnit,
} from "@translation/contracts";
import type {
  EnterpriseUsageAdjustmentRecord,
  EnterpriseUsageEventRecord,
  EnterpriseUsagePeriodAggregateRecord,
} from "../../modules/enterprise/enterprise-usage-accounting.js";

export type EnterpriseUsageAccountingRow = Record<string, unknown>;

export function mapEnterpriseUsageEvent(
  row: EnterpriseUsageAccountingRow,
  tenantId: string,
): EnterpriseUsageEventRecord {
  assertTenant(row, tenantId);
  return {
    id: text(row.id, "event id"),
    tenantId,
    billingAccountId: text(row.billing_account_id, "billing account"),
    ...optionalText("budgetId", row.budget_id),
    ...optionalText("holdId", row.hold_id),
    ledgerEntryId: text(row.ledger_entry_id, "ledger entry"),
    category: category(row.category),
    unit: unit(row.unit),
    amount: integer(row.amount, "event amount", 0),
    sourceType: text(row.source_type, "source type"),
    sourceRef: text(row.source_ref, "source ref"),
    idempotencyKey: text(row.idempotency_key, "idempotency key"),
    requestHash: hash(row.request_hash, "request hash"),
    occurredAt: timestamp(row.occurred_at, "occurred at"),
    receivedAt: timestamp(row.received_at, "received at"),
    metadata: metadata(row.metadata),
  };
}

export function mapEnterpriseUsageAdjustment(
  row: EnterpriseUsageAccountingRow,
  tenantId: string,
): EnterpriseUsageAdjustmentRecord {
  assertTenant(row, tenantId);
  return {
    id: text(row.id, "adjustment id"),
    tenantId,
    billingAccountId: text(row.billing_account_id, "billing account"),
    targetLedgerEntryId: text(row.target_ledger_entry_id, "target ledger entry"),
    adjustmentLedgerEntryId: text(
      row.adjustment_ledger_entry_id,
      "adjustment ledger entry",
    ),
    deltaAmount: integer(row.delta_amount, "delta amount"),
    reasonCode: text(row.reason_code, "reason code"),
    idempotencyKey: text(row.idempotency_key, "idempotency key"),
    requestHash: hash(row.request_hash, "request hash"),
    actorId: text(row.actor_id, "actor"),
    createdAt: timestamp(row.created_at, "adjustment created at"),
  };
}

export function mapEnterpriseUsagePeriodAggregate(
  row: EnterpriseUsageAccountingRow,
  tenantId: string,
): EnterpriseUsagePeriodAggregateRecord {
  assertTenant(row, tenantId);
  return {
    id: text(row.id, "aggregate id"),
    tenantId,
    billingAccountId: text(row.billing_account_id, "billing account"),
    category: category(row.category),
    unit: unit(row.unit),
    periodStart: timestamp(row.period_start, "period start"),
    periodEnd: timestamp(row.period_end, "period end"),
    settledAmount: integer(row.settled_amount, "settled amount", 0),
    adjustmentAmount: integer(row.adjustment_amount, "adjustment amount"),
    netAmount: integer(row.net_amount, "net amount", 0),
    settlementCount: integer(row.settlement_count, "settlement count", 0),
    usageEventCount: integer(row.usage_event_count, "usage event count", 0),
    adjustmentCount: integer(row.adjustment_count, "adjustment count", 0),
    ledgerCount: integer(row.ledger_count, "ledger count", 0),
    ledgerHash: hash(row.ledger_hash, "ledger hash"),
    ...optionalTimestamp("sourceWatermark", row.source_watermark),
    computedAt: timestamp(row.computed_at, "computed at"),
    version: integer(row.version, "aggregate version", 1),
  };
}

function assertTenant(row: EnterpriseUsageAccountingRow, expected: string) {
  if (text(row.tenant_id, "tenant") !== expected) {
    throw new Error("Enterprise usage accounting tenant mismatch");
  }
}
function category(value: unknown) {
  if (!isEnterpriseUsageCategory(value)) throw new Error("Invalid usage category");
  return value;
}
function unit(value: unknown) {
  if (!isEnterpriseUsageUnit(value)) throw new Error("Invalid usage unit");
  return value;
}
function integer(value: unknown, field: string, minimum?: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) ||
    (minimum !== undefined && parsed < minimum)) {
    throw new Error(`Invalid enterprise usage ${field}`);
  }
  return parsed;
}
function text(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid enterprise usage ${field}`);
  }
  return value.trim();
}
function hash(value: unknown, field: string) {
  const parsed = text(value, field);
  if (!/^[a-f0-9]{64}$/.test(parsed)) {
    throw new Error(`Invalid enterprise usage ${field}`);
  }
  return parsed;
}
function timestamp(value: unknown, field: string) {
  const parsed = value instanceof Date ? value.toISOString() : text(value, field);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new Error(`Invalid enterprise usage ${field}`);
  }
  return parsed;
}
function metadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid enterprise usage metadata");
  }
  return value as EnterpriseUsageEventRecord["metadata"];
}
function optionalText(key: "budgetId" | "holdId", value: unknown) {
  return value === null || value === undefined ? {} : { [key]: text(value, key) };
}
function optionalTimestamp(key: "sourceWatermark", value: unknown) {
  return value === null || value === undefined
    ? {}
    : { [key]: timestamp(value, key) };
}
