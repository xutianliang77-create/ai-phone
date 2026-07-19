import type {
  EnterpriseMarketingPstnDispatchCounts,
  EnterpriseMarketingPstnWebhookRequest,
} from "@translation/contracts";
import type { EnterpriseMarketingPstnProviderResult } from
  "./enterprise-marketing-pstn-provider.js";
import type {
  EnterpriseMarketingPstnCallRequest,
  EnterpriseMarketingPstnDispatchRecord,
} from "./enterprise-marketing-pstn.js";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseMarketingPstnRepositoryRuntime {
  getMarketingPstnStatus?(input: { context: EnterpriseTenantContext;
    campaignId: string }): Promise<{ status: "ready";
      dispatches: EnterpriseMarketingPstnDispatchCounts; protectionReady: boolean } |
      { status: "not_found" } | StorageRequired>;
  prepareMarketingPstnDispatch?(input: { tenantId: string; homeRegion: string;
    cellId: string; routeEpoch: number; taskId: string; dispatchGeneration: number;
    claimToken: string; provider: "pstn_http" | "pstn_fonoster";
    providerFingerprint: string; agentProviderFingerprint: string;
    enterpriseAgent: EnterpriseMarketingPstnCallRequest["enterpriseAgent"];
    traceId: string; now: Date }): Promise<
      { status: "prepared"; dispatch: EnterpriseMarketingPstnDispatchRecord;
        request: EnterpriseMarketingPstnCallRequest } |
      { status: "already_accepted"; dispatch: EnterpriseMarketingPstnDispatchRecord } |
      { status: "route_mismatch" | "not_found" | "claim_rejected" |
        "policy_rejected" | "protection_not_ready" | "agent_profile_not_ready" |
        "agent_content_not_ready" | "agent_run_conflict" | "conflict" } | StorageRequired>;
  finalizeMarketingPstnDispatch?(input: { tenantId: string; dispatchId: string;
    result: EnterpriseMarketingPstnProviderResult; traceId: string;
    now: Date }): Promise<{ status: "accepted" | "already_accepted" |
      "reconciliation_required" | "failed";
      dispatch: EnterpriseMarketingPstnDispatchRecord } |
      { status: "not_found" | "billing_rejected" } | StorageRequired>;
  ingestMarketingPstnWebhook?(input: { event: EnterpriseMarketingPstnWebhookRequest;
    traceId: string; now: Date }): Promise<{ status: "accepted" | "duplicate" |
      "stale" } | { status: "route_mismatch" | "not_found" |
      "billing_rejected" | "event_conflict" } | StorageRequired>;
}
