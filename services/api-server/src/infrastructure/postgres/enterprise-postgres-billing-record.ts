import type {
  EnterpriseBillingAccountRecord,
  EnterpriseEntitlementSnapshotRecord,
  EnterpriseEntitlementValue,
  EnterprisePlanVersionRecord,
  EnterpriseSubscriptionRecord,
} from "../../modules/enterprise/enterprise-billing-entitlement.js";

export type BillingRow = Record<string, unknown>;

export function mapBillingAccount(
  row: BillingRow,
  tenantId: string,
): EnterpriseBillingAccountRecord {
  assertTenant(row, tenantId);
  const status = required(row.status, "account status");
  if (!["active", "past_due", "suspended", "closed"].includes(status)) {
    throw new Error("Invalid enterprise billing account status");
  }
  return {
    id: required(row.id, "account id"),
    tenantId,
    status: status as EnterpriseBillingAccountRecord["status"],
    currency: currency(row.currency),
    ...optionalText("billingContactSubjectId", row.billing_contact_subject_id),
    createdAt: timestamp(row.created_at, "account created at"),
    updatedAt: timestamp(row.updated_at, "account updated at"),
    version: positive(row.version, "account version"),
  };
}

export function mapPlanVersion(
  row: BillingRow,
  tenantId: string,
): EnterprisePlanVersionRecord {
  assertTenant(row, tenantId);
  const status = required(row.status, "plan status");
  const billingCycle = required(row.billing_cycle, "billing cycle");
  if (status !== "published" && status !== "retired") {
    throw new Error("Invalid enterprise plan status");
  }
  if (billingCycle !== "monthly" && billingCycle !== "annual") {
    throw new Error("Invalid enterprise billing cycle");
  }
  return {
    id: required(row.id, "plan id"),
    tenantId,
    planCode: required(row.plan_code, "plan code"),
    planVersion: required(row.plan_version, "plan version"),
    status,
    currency: currency(row.currency),
    billingCycle,
    seatLimit: nonNegative(row.seat_limit, "seat limit"),
    entitlements: entitlementMap(row.entitlements),
    publishedAt: timestamp(row.published_at, "plan published at"),
    ...optionalTimestamp("retiredAt", row.retired_at),
  };
}

export function mapSubscription(
  row: BillingRow,
  tenantId: string,
): EnterpriseSubscriptionRecord {
  assertTenant(row, tenantId);
  return {
    id: required(row.id, "subscription id"),
    tenantId,
    billingAccountId: required(row.billing_account_id, "billing account"),
    planCode: required(row.plan_code, "plan code"),
    planVersion: required(row.plan_version, "plan version"),
    status: required(row.status, "subscription status"),
    seats: nonNegative(row.seats, "seats"),
    billingCycle: required(row.billing_cycle, "billing cycle"),
    currentPeriodStart: timestamp(row.current_period_start, "period start"),
    currentPeriodEnd: timestamp(row.current_period_end, "period end"),
    createdAt: timestamp(row.created_at, "subscription created at"),
    updatedAt: timestamp(row.updated_at, "subscription updated at"),
    version: positive(row.version, "subscription version"),
  };
}

export function mapEntitlementSnapshot(
  row: BillingRow,
  tenantId: string,
): EnterpriseEntitlementSnapshotRecord {
  assertTenant(row, tenantId);
  const status = required(row.status, "entitlement status");
  if (status !== "active" && status !== "retired") {
    throw new Error("Invalid enterprise entitlement status");
  }
  return {
    id: required(row.id, "entitlement id"),
    tenantId,
    billingAccountId: required(row.billing_account_id, "billing account"),
    subscriptionId: required(row.subscription_id, "subscription"),
    entitlementVersion: required(row.entitlement_version, "entitlement version"),
    status,
    planCode: required(row.plan_code, "plan code"),
    planVersion: required(row.plan_version, "plan version"),
    entitlements: entitlementMap(row.entitlements),
    effectiveFrom: timestamp(row.effective_from, "effective from"),
    ...optionalTimestamp("effectiveUntil", row.effective_until),
    createdAt: timestamp(row.created_at, "entitlement created at"),
  };
}

export function entitlementMap(value: unknown) {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!candidate) throw new Error("Invalid enterprise entitlement map");
  return Object.fromEntries(Object.entries(candidate).map(([key, raw]) => {
    if (!key.trim() || key.length > 160 || !raw || typeof raw !== "object") {
      throw new Error("Invalid enterprise entitlement entry");
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.enabled !== "boolean" ||
      (entry.limit !== null && (!Number.isSafeInteger(Number(entry.limit)) ||
        Number(entry.limit) < 0))) {
      throw new Error("Invalid enterprise entitlement value");
    }
    return [key, {
      enabled: entry.enabled,
      limit: entry.limit === null ? null : Number(entry.limit),
    } satisfies EnterpriseEntitlementValue];
  }));
}

function assertTenant(row: BillingRow, expected: string) {
  if (required(row.tenant_id, "tenant") !== expected) {
    throw new Error("Enterprise billing tenant mismatch");
  }
}
function required(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid enterprise ${field}`);
  }
  return value.trim();
}
function nonNegative(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid enterprise ${field}`);
  }
  return parsed;
}
function positive(value: unknown, field: string) {
  const parsed = nonNegative(value, field);
  if (parsed < 1) throw new Error(`Invalid enterprise ${field}`);
  return parsed;
}
function currency(value: unknown) {
  const parsed = required(value, "currency");
  if (!/^[A-Z]{3}$/.test(parsed)) throw new Error("Invalid enterprise currency");
  return parsed;
}
function timestamp(value: unknown, field: string) {
  const parsed = value instanceof Date ? value.toISOString() : required(value, field);
  if (!Number.isFinite(Date.parse(parsed))) throw new Error(`Invalid enterprise ${field}`);
  return parsed;
}
function optionalText(key: "billingContactSubjectId", value: unknown) {
  return value === null || value === undefined ? {} : { [key]: required(value, key) };
}
function optionalTimestamp(
  key: "retiredAt" | "effectiveUntil",
  value: unknown,
) {
  return value === null || value === undefined ? {} : { [key]: timestamp(value, key) };
}
