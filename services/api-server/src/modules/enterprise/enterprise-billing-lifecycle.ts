export const enterpriseBillingLifecycleEventTypes = [
  "renewed",
  "payment_failed",
  "grace_expired",
  "payment_recovered",
  "cancelled",
] as const;
export type EnterpriseBillingLifecycleEventType =
  typeof enterpriseBillingLifecycleEventTypes[number];

export interface EnterpriseBillingLifecycleEventInput {
  provider: string;
  providerEventId: string;
  subscriptionId: string;
  eventType: EnterpriseBillingLifecycleEventType;
  providerPayloadHash: string;
  occurredAt: string;
  effectiveAt: string;
  periodStart?: string;
  periodEnd?: string;
}

export interface EnterpriseBillingLifecycleCommand {
  id: string;
  tenantId: string;
  eventId: string;
  status: "pending" | "processing" | "completed" | "failed";
  dueAt: string;
  attempts: number;
  leaseOwner?: string;
  leaseGeneration: number;
  leaseExpiresAt?: string;
  errorCode?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseBillingLifecycleStatus {
  accountStatus: "active" | "past_due" | "suspended" | "closed";
  subscriptionId: string;
  subscriptionStatus:
    | "active" | "past_due" | "suspended" | "superseded" | "cancelled";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  lastEventType?: EnterpriseBillingLifecycleEventType;
  lastDecisionAction?: "applied" | "ignored";
  lastDecisionReason?: string;
  updatedAt: string;
}

export type EnterpriseBillingLifecycleIngestResult =
  | { status: "queued" | "replayed"; command: EnterpriseBillingLifecycleCommand }
  | { status: "account_not_found" }
  | { status: "subscription_not_found" }
  | { status: "idempotency_conflict" }
  | { status: "storage_required" };

export interface EnterpriseBillingLifecycleRuntime {
  ingestBillingLifecycleEvent?(input: {
    context: import("./enterprise-tenant-context.js").EnterpriseTenantContext;
    event: EnterpriseBillingLifecycleEventInput;
  }): Promise<EnterpriseBillingLifecycleIngestResult>;
  getBillingLifecycleStatus?(input: {
    context: import("./enterprise-tenant-context.js").EnterpriseTenantContext;
  }): Promise<
    | { status: "ready"; lifecycle: EnterpriseBillingLifecycleStatus }
    | { status: "not_found" }
    | { status: "storage_required" }
  >;
}
