import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type {
  CreateEnterpriseSupportChannelInput,
  CreateEnterpriseSupportSessionInput,
  EnterpriseSupportChannelRecord,
  EnterpriseSupportSessionAggregate,
  EnterpriseSupportSessionStatus,
} from "./enterprise-support.js";
import type {
  EnterpriseSupportInboundAuthorization,
  EnterpriseSupportInboundEvent,
  EnterpriseSupportInboundResult,
  EnterpriseSupportInboundRoute,
} from "./enterprise-support-inbound.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseSupportRepositoryRuntime {
  createSupportChannel?(input: {
    context: EnterpriseTenantContext;
    channel: CreateEnterpriseSupportChannelInput;
  }): Promise<
    | { status: "created"; channel: EnterpriseSupportChannelRecord }
    | { status: "conflict" }
    | StorageRequired
  >;
  authorizeSupportInboundChannel?(input: {
    context: EnterpriseTenantContext;
    channelId: string;
    channelType: EnterpriseSupportInboundRoute["channelType"];
  }): Promise<
    | { status: "ready"; authorization: EnterpriseSupportInboundAuthorization }
    | { status: "channel_not_found" | "channel_unavailable" | "route_not_ready" }
    | StorageRequired
  >;
  ingestSupportInbound?(input: {
    context: EnterpriseTenantContext;
    route: EnterpriseSupportInboundRoute;
    event: EnterpriseSupportInboundEvent;
  }): Promise<EnterpriseSupportInboundResult | StorageRequired>;
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
