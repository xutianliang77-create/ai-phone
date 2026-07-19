import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type {
  CreateEnterpriseSupportSessionInput,
  EnterpriseSupportSessionAggregate,
  EnterpriseSupportSessionStatus,
} from "./enterprise-support.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseSupportRepositoryRuntime {
  createSupportSession?(input: {
    context: EnterpriseTenantContext;
    session: CreateEnterpriseSupportSessionInput;
    bindingId: string;
    communicationSessionId: string;
  }): Promise<
    | { status: "created" | "replayed"; aggregate: EnterpriseSupportSessionAggregate }
    | { status: "idempotency_conflict" | "resource_not_found" |
        "channel_unavailable" | "policy_not_ready" | "entitlement_not_ready" |
        "route_not_ready" }
    | StorageRequired
  >;
  getSupportSession?(input: {
    context: EnterpriseTenantContext;
    sessionId: string;
  }): Promise<
    | { status: "ready"; aggregate: EnterpriseSupportSessionAggregate }
    | { status: "not_found" }
    | StorageRequired
  >;
  listRecoverableSupportSessions?(input: {
    context: EnterpriseTenantContext;
  }): Promise<
    | { status: "ready"; sessions: EnterpriseSupportSessionAggregate[] }
    | StorageRequired
  >;
  transitionSupportSession?(input: {
    context: EnterpriseTenantContext;
    sessionId: string;
    status: EnterpriseSupportSessionStatus;
    expectedVersion: number;
    occurredAt: string;
    queueId?: string;
    assignedUserId?: string;
    failureCode?: string;
  }): Promise<
    | { status: "updated"; aggregate: EnterpriseSupportSessionAggregate }
    | { status: "not_found" | "conflict" | "invalid_transition" |
        "resource_not_found" | "resource_unavailable" }
    | StorageRequired
  >;
}
