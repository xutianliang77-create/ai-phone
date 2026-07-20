import type {
  EnterpriseMarketingHandoffPolicyDto,
  EnterpriseMarketingHandoffStatusResponse,
} from "@translation/contracts";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseMarketingHandoffRepositoryRuntime {
  processMarketingHandoffTimeouts?(input: { tenantId: string; homeRegion: string;
    cellId: string; routeEpoch: number; workerId: string; traceId: string; now: string;
    batchSize: number }): Promise<
      { status: "processed" | "empty"; processed: Array<{ handoffId: string;
        supportSessionId: string; outcome: "timed_out" | "callback_required" }> } |
      { status: "route_mismatch" } | StorageRequired>;
  getMarketingHandoffStatus?(input: { context: EnterpriseTenantContext;
    campaignId: string }): Promise<
      { status: "ready"; campaignId: string;
        policy?: EnterpriseMarketingHandoffPolicyDto;
        readiness: EnterpriseMarketingHandoffStatusResponse["readiness"];
        provider: EnterpriseMarketingHandoffStatusResponse["provider"] } |
      { status: "not_found" } | StorageRequired>;
  upsertMarketingHandoffPolicy?(input: { context: EnterpriseTenantContext;
    campaignId: string; policyId: string; supportQueueId: string;
    supportChannelId: string; timeoutSeconds: number;
    timeoutAction: "end_call" | "callback"; callbackDelaySeconds?: number;
    expectedVersion?: number; idempotencyKey: string; requestHash: string;
    occurredAt: string }): Promise<
      { status: "created" | "updated" | "replayed";
        policy: EnterpriseMarketingHandoffPolicyDto } |
      { status: "not_found" | "not_editable" | "resource_not_ready" |
        "version_conflict" | "idempotency_conflict" } | StorageRequired>;
}
