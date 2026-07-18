export interface EnterpriseBillingAccountRecord {
  id: string;
  tenantId: string;
  status: "active" | "past_due" | "suspended" | "closed";
  currency: string;
  billingContactSubjectId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseEntitlementValue {
  enabled: boolean;
  limit: number | null;
}

export interface EnterprisePlanVersionRecord {
  id: string;
  tenantId: string;
  planCode: string;
  planVersion: string;
  status: "published" | "retired";
  currency: string;
  billingCycle: "monthly" | "annual";
  seatLimit: number;
  entitlements: Record<string, EnterpriseEntitlementValue>;
  publishedAt: string;
  retiredAt?: string;
}

export interface EnterpriseSubscriptionRecord {
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

export interface EnterpriseEntitlementSnapshotRecord {
  id: string;
  tenantId: string;
  billingAccountId: string;
  subscriptionId: string;
  entitlementVersion: string;
  status: "active" | "retired";
  planCode: string;
  planVersion: string;
  entitlements: Record<string, EnterpriseEntitlementValue>;
  effectiveFrom: string;
  effectiveUntil?: string;
  createdAt: string;
}

export interface ChangeEnterpriseSubscriptionInput {
  planCode: string;
  planVersion: string;
  seats: number;
  billingCycle: "monthly" | "annual";
  idempotencyKey: string;
  now?: Date;
}

export interface EnterpriseEntitlementState {
  account: EnterpriseBillingAccountRecord;
  subscription: EnterpriseSubscriptionRecord;
  entitlement: EnterpriseEntitlementSnapshotRecord;
}

export type ChangeEnterpriseSubscriptionResult =
  | ({ status: "changed" | "replayed" } & EnterpriseEntitlementState)
  | { status: "plan_not_found" }
  | { status: "plan_retired" }
  | { status: "billing_account_inactive" }
  | { status: "seat_limit_exceeded" }
  | { status: "idempotency_conflict" };

export type EnterpriseDispatchEntitlementResult =
  | {
    status: "allowed";
    billingAccountId: string;
    entitlementVersion: string;
    limit: number;
  }
  | { status: "entitlement_unavailable" | "entitlement_denied" };
