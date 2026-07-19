import type { EnterpriseSupportRagResponse } from "@translation/contracts";
import type { SearchEnterpriseKnowledgeInput } from "./enterprise-knowledge.js";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type {
  CreateEnterpriseSupportQueueInput,
  CreateEnterpriseSupportChannelInput,
  CreateEnterpriseSupportSessionInput,
  EnterpriseSupportChannelRecord,
  EnterpriseSupportQueueRecord,
  EnterpriseSupportSessionAggregate,
  EnterpriseSupportSessionStatus,
  EnterpriseSupportFollowupRecord,
} from "./enterprise-support.js";
import type { EnterpriseSupportWritePublishReceipt } from
  "./enterprise-support-write-tool.js";
import type {
  EnterpriseSupportAgentClaimRecord,
  EnterpriseSupportQueueWorkItem,
} from "./enterprise-support-agent-queue.js";
import type { EnterpriseSupportWorkbenchSnapshot } from
  "./enterprise-support-workbench.js";
import type {
  EnterpriseSupportInboundAuthorization,
  EnterpriseSupportInboundEvent,
  EnterpriseSupportInboundResult,
  EnterpriseSupportInboundRoute,
} from "./enterprise-support-inbound.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseSupportRepositoryRuntime {
  createSupportFollowup?(input: {
    context: EnterpriseTenantContext; sessionId: string;
    expectedSessionVersion: number; expectedClaimVersion: number;
    idempotencyKey: string; now: string;
    action: { kind: "ticket"; subject: string; description: string } |
      { kind: "callback"; scheduledAt: string; reason: string };
  }): Promise<
    | { status: "processing" | "replayed"; followup: EnterpriseSupportFollowupRecord }
    | { status: "not_configured"; reasonCode: string }
    | { status: "not_found" | "not_active" | "forbidden" |
        "claim_not_active" | "claim_expired" | "conflict" |
        "idempotency_conflict" | "invalid_arguments" }
    | StorageRequired
  >;
  finalizeSupportFollowupOutbox?(input: {
    context: EnterpriseTenantContext; eventId: string; attempt: number;
    result: { status: "completed"; receipt: EnterpriseSupportWritePublishReceipt } |
      { status: "retry"; reason: string };
    now: Date;
  }): Promise<{ status: "completed" | "retried" | "failed" }>;
  activateSupportWorkbench?(input: {
    context: EnterpriseTenantContext; sessionId: string; now: string;
  }): Promise<
    | { status: "ready"; workbench: EnterpriseSupportWorkbenchSnapshot }
    | { status: "not_found" | "not_active" | "forbidden" |
        "claim_not_active" | "claim_expired" }
    | StorageRequired
  >;
  getSupportWorkbench?(input: {
    context: EnterpriseTenantContext; sessionId: string; now: string;
  }): Promise<
    | { status: "ready"; workbench: EnterpriseSupportWorkbenchSnapshot }
    | { status: "not_found" | "not_active" | "forbidden" |
        "claim_not_active" | "claim_expired" | "ai_stop_not_verified" }
    | StorageRequired
  >;
  createSupportQueue?(input: {
    context: EnterpriseTenantContext;
    queue: CreateEnterpriseSupportQueueInput;
  }): Promise<
    | { status: "created"; queue: EnterpriseSupportQueueRecord }
    | { status: "conflict" }
    | StorageRequired
  >;
  listSupportQueues?(input: {
    context: EnterpriseTenantContext;
  }): Promise<
    | { status: "ready"; queues: EnterpriseSupportQueueRecord[] }
    | StorageRequired
  >;
  listSupportQueueWorkItems?(input: {
    context: EnterpriseTenantContext; queueId: string; limit: number; now: string;
  }): Promise<
    | { status: "ready"; workItems: EnterpriseSupportQueueWorkItem[] }
    | { status: "queue_not_found" | "queue_unavailable" }
    | StorageRequired
  >;
  claimSupportSession?(input: {
    context: EnterpriseTenantContext; sessionId: string;
    expectedSessionVersion: number; idempotencyKey: string; now: string;
  }): Promise<
    | { status: "claimed" | "replayed"; claim: EnterpriseSupportAgentClaimRecord;
        session: EnterpriseSupportSessionAggregate["session"];
        aiSpeechFence?: EnterpriseSupportWorkbenchSnapshot["aiSpeechFence"] }
    | { status: "not_found" | "queue_not_found" | "queue_unavailable" |
        "not_handoff_requested" | "already_claimed" | "conflict" |
        "idempotency_conflict" }
    | StorageRequired
  >;
  renewSupportAgentClaim?(input: {
    context: EnterpriseTenantContext; claimId: string;
    expectedClaimVersion: number; now: string;
  }): Promise<
    | { status: "renewed"; claim: EnterpriseSupportAgentClaimRecord }
    | { status: "not_found" | "forbidden" | "claim_not_active" |
        "claim_expired" | "queue_not_found" | "conflict" }
    | StorageRequired
  >;
  releaseSupportAgentClaim?(input: {
    context: EnterpriseTenantContext; claimId: string;
    expectedClaimVersion: number; expectedSessionVersion: number;
    idempotencyKey: string; reason: "agent_release" | "agent_disconnect";
    now: string;
  }): Promise<
    | { status: "released" | "replayed"; claim: EnterpriseSupportAgentClaimRecord;
        session: EnterpriseSupportSessionAggregate["session"] }
    | { status: "not_found" | "forbidden" | "claim_not_active" |
        "conflict" | "idempotency_conflict" }
    | StorageRequired
  >;
  reassignSupportAgentClaim?(input: {
    context: EnterpriseTenantContext; claimId: string; targetUserId: string;
    expectedClaimVersion: number; expectedSessionVersion: number;
    idempotencyKey: string; now: string;
  }): Promise<
    | { status: "reassigned" | "replayed";
        previousClaim: EnterpriseSupportAgentClaimRecord;
        claim: EnterpriseSupportAgentClaimRecord;
        session: EnterpriseSupportSessionAggregate["session"] }
    | { status: "not_found" | "forbidden" | "claim_not_active" |
        "target_not_eligible" | "conflict" | "idempotency_conflict" }
    | StorageRequired
  >;
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
  resolveSupportKnowledge?(input: {
    context: EnterpriseTenantContext;
    sessionId: string;
    search: SearchEnterpriseKnowledgeInput;
  }): Promise<
    | { status: "ready"; resolution: EnterpriseSupportRagResponse }
    | { status: "not_found" | "not_active" }
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
    activeAgentClaimId?: string;
    failureCode?: string;
  }): Promise<
    | { status: "updated"; aggregate: EnterpriseSupportSessionAggregate }
    | { status: "not_found" | "conflict" | "invalid_transition" |
        "resource_not_found" | "resource_unavailable" }
    | StorageRequired
  >;
}
