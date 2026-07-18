import {
  isEnterpriseUsageCategory,
  isEnterpriseUsageUnit,
} from "@translation/contracts";
import type {
  EnterpriseUsageBudgetRecord,
  EnterpriseUsageHoldRecord,
} from "../../modules/enterprise/enterprise-usage-budget.js";

export interface EnterpriseUsageBudgetRow extends Record<string, unknown> {
  id: unknown;
  tenant_id: unknown;
  billing_account_id: unknown;
  category: unknown;
  unit: unknown;
  limit_amount: unknown;
  alert_threshold_percent: unknown;
  status: unknown;
  period_start: unknown;
  period_end: unknown;
  created_at: unknown;
  updated_at: unknown;
  version: unknown;
}

export interface EnterpriseUsageHoldRow extends Record<string, unknown> {
  id: unknown;
  tenant_id: unknown;
  billing_account_id: unknown;
  budget_id: unknown;
  category: unknown;
  unit: unknown;
  amount: unknown;
  settled_amount: unknown;
  status: unknown;
  source_type: unknown;
  source_ref: unknown;
  idempotency_key: unknown;
  request_hash: unknown;
  held_at: unknown;
  expires_at: unknown;
  settled_at: unknown;
  released_at: unknown;
  updated_at: unknown;
  version: unknown;
}

export function mapEnterpriseUsageBudgetRow(
  row: EnterpriseUsageBudgetRow,
  expectedTenantId: string,
): EnterpriseUsageBudgetRecord {
  const tenantId = required(row.tenant_id, "tenant");
  const category = required(row.category, "category");
  const unit = required(row.unit, "unit");
  const status = required(row.status, "status");
  if (tenantId !== expectedTenantId) throw new Error("Usage budget tenant mismatch");
  if (!isEnterpriseUsageCategory(category)) throw new Error("Invalid usage category");
  if (!isEnterpriseUsageUnit(unit)) throw new Error("Invalid usage unit");
  if (status !== "active" && status !== "paused") {
    throw new Error("Invalid usage budget status");
  }
  return {
    id: required(row.id, "id"),
    tenantId,
    billingAccountId: required(row.billing_account_id, "billing account"),
    category,
    unit,
    limitAmount: nonNegative(row.limit_amount, "limit"),
    alertThresholdPercent: percent(row.alert_threshold_percent),
    status,
    periodStart: timestamp(row.period_start, "period start"),
    periodEnd: timestamp(row.period_end, "period end"),
    createdAt: timestamp(row.created_at, "created at"),
    updatedAt: timestamp(row.updated_at, "updated at"),
    version: positive(row.version, "version"),
  };
}

export function mapEnterpriseUsageHoldRow(
  row: EnterpriseUsageHoldRow,
  expectedTenantId: string,
): EnterpriseUsageHoldRecord {
  const tenantId = required(row.tenant_id, "tenant");
  const category = required(row.category, "category");
  const unit = required(row.unit, "unit");
  const status = required(row.status, "status");
  if (tenantId !== expectedTenantId) throw new Error("Usage hold tenant mismatch");
  if (!isEnterpriseUsageCategory(category)) throw new Error("Invalid usage category");
  if (!isEnterpriseUsageUnit(unit)) throw new Error("Invalid usage unit");
  if (!["held", "settled", "released", "expired"].includes(status)) {
    throw new Error("Invalid usage hold status");
  }
  const settledAmount = optionalNonNegative(row.settled_amount, "settled amount");
  return {
    id: required(row.id, "id"),
    tenantId,
    billingAccountId: required(row.billing_account_id, "billing account"),
    budgetId: required(row.budget_id, "budget"),
    category,
    unit,
    amount: positive(row.amount, "amount"),
    ...(settledAmount === undefined ? {} : { settledAmount }),
    status: status as EnterpriseUsageHoldRecord["status"],
    sourceType: required(row.source_type, "source type"),
    sourceRef: required(row.source_ref, "source ref"),
    idempotencyKey: required(row.idempotency_key, "idempotency key"),
    requestHash: hash(row.request_hash),
    heldAt: timestamp(row.held_at, "held at"),
    expiresAt: timestamp(row.expires_at, "expires at"),
    ...optionalTimestamp("settledAt", row.settled_at),
    ...optionalTimestamp("releasedAt", row.released_at),
    updatedAt: timestamp(row.updated_at, "updated at"),
    version: positive(row.version, "version"),
  };
}

function required(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid enterprise usage ${field}`);
  }
  return value.trim();
}
function integer(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid enterprise usage ${field}`);
  return parsed;
}
function positive(value: unknown, field: string) {
  const parsed = integer(value, field);
  if (parsed < 1) throw new Error(`Invalid enterprise usage ${field}`);
  return parsed;
}
function nonNegative(value: unknown, field: string) {
  const parsed = integer(value, field);
  if (parsed < 0) throw new Error(`Invalid enterprise usage ${field}`);
  return parsed;
}
function optionalNonNegative(value: unknown, field: string) {
  return value === null || value === undefined ? undefined : nonNegative(value, field);
}
function percent(value: unknown) {
  const parsed = integer(value, "threshold");
  if (parsed < 1 || parsed > 100) throw new Error("Invalid usage threshold");
  return parsed;
}
function timestamp(value: unknown, field: string) {
  const parsed = value instanceof Date ? value.toISOString() : required(value, field);
  if (!Number.isFinite(Date.parse(parsed))) throw new Error(`Invalid usage ${field}`);
  return parsed;
}
function optionalTimestamp(
  key: "settledAt" | "releasedAt",
  value: unknown,
) {
  return value === null || value === undefined ? {} : { [key]: timestamp(value, key) };
}
function hash(value: unknown) {
  const parsed = required(value, "request hash");
  if (!/^[a-f0-9]{64}$/.test(parsed)) throw new Error("Invalid usage request hash");
  return parsed;
}
