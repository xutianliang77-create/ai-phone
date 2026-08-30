export const enterpriseUsageCategories = [
  "meeting_audio_seconds",
  "screen_share_seconds",
  "screen_ocr_frames",
  "support_ai_seconds",
  "support_human_seconds",
  "marketing_call_seconds",
  "pstn_seconds",
  "asr_seconds",
  "tts_characters",
  "llm_input_tokens",
  "llm_output_tokens",
] as const;

export type EnterpriseUsageCategory =
  (typeof enterpriseUsageCategories)[number];

export const enterpriseUsageUnits = [
  "seconds",
  "frames",
  "characters",
  "tokens",
] as const;

export type EnterpriseUsageUnit = (typeof enterpriseUsageUnits)[number];

export interface EnterpriseUsageBudgetDto {
  id: string;
  tenantId: string;
  billingAccountId: string;
  category: EnterpriseUsageCategory;
  unit: EnterpriseUsageUnit;
  limitAmount: number;
  alertThresholdPercent: number;
  status: "active" | "paused";
  periodStart: string;
  periodEnd: string;
  version: number;
  updatedAt: string;
}

export interface ConfigureEnterpriseUsageBudgetRequest {
  tenantId?: string;
  unit: EnterpriseUsageUnit;
  limitAmount: number;
  alertThresholdPercent: number;
  periodStart: string;
  periodEnd: string;
  expectedVersion?: number;
}

export interface EnterpriseUsageBudgetsResponse {
  budgets: EnterpriseUsageBudgetDto[];
}

export interface EnterpriseBillingAccountDto {
  id: string;
  tenantId: string;
  status: "active" | "past_due" | "suspended" | "closed";
  currency: string;
  billingContactSubjectId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseEntitlementValueDto {
  enabled: boolean;
  limit: number | null;
}

export interface EnterpriseEntitlementSnapshotDto {
  id: string;
  tenantId: string;
  billingAccountId: string;
  subscriptionId: string;
  entitlementVersion: string;
  status: "active" | "retired";
  planCode: string;
  planVersion: string;
  entitlements: Record<string, EnterpriseEntitlementValueDto>;
  effectiveFrom: string;
  effectiveUntil?: string;
  createdAt: string;
}

export interface EnterpriseSubscriptionDto {
  id: string;
  tenantId: string;
  billingAccountId: string;
  planCode: string;
  planVersion: string;
  status: string;
  seats: number;
  billingCycle: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ChangeEnterpriseSubscriptionRequest {
  tenantId?: string;
  planCode: string;
  planVersion: string;
  seats: number;
  billingCycle: "monthly" | "annual";
  idempotencyKey: string;
}

export interface EnterpriseEntitlementsResponse {
  account: EnterpriseBillingAccountDto;
  subscription: EnterpriseSubscriptionDto;
  entitlement: EnterpriseEntitlementSnapshotDto;
}

export interface EnterpriseBillingLifecycleStatusResponse {
  accountStatus: "active" | "past_due" | "suspended" | "closed";
  subscriptionId: string;
  subscriptionStatus:
    | "active" | "past_due" | "suspended" | "superseded" | "cancelled";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  lastEventType?:
    | "renewed" | "payment_failed" | "grace_expired"
    | "payment_recovered" | "cancelled";
  lastDecisionAction?: "applied" | "ignored";
  lastDecisionReason?: string;
  updatedAt: string;
}

export interface EnterpriseUsagePeriodAggregateDto {
  id: string;
  tenantId: string;
  billingAccountId: string;
  category: EnterpriseUsageCategory;
  unit: EnterpriseUsageUnit;
  periodStart: string;
  periodEnd: string;
  settledAmount: number;
  adjustmentAmount: number;
  netAmount: number;
  settlementCount: number;
  usageEventCount: number;
  adjustmentCount: number;
  ledgerCount: number;
  ledgerHash: string;
  sourceWatermark?: string;
  computedAt: string;
  version: number;
}

export interface EnterpriseUsagePeriodAggregatesResponse {
  aggregates: EnterpriseUsagePeriodAggregateDto[];
}

export function isEnterpriseUsageCategory(
  value: unknown,
): value is EnterpriseUsageCategory {
  return typeof value === "string" && enterpriseUsageCategories.includes(
    value as EnterpriseUsageCategory,
  );
}

export function isEnterpriseUsageUnit(
  value: unknown,
): value is EnterpriseUsageUnit {
  return typeof value === "string" && enterpriseUsageUnits.includes(
    value as EnterpriseUsageUnit,
  );
}
