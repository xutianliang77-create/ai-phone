import type { EnterpriseMarketingCrmSyncListResponse } from "@translation/contracts";
import type { EnterpriseMarketingCrmPublishReceipt,
  EnterpriseMarketingCrmSyncRecord } from "./enterprise-marketing-crm.js";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

type StorageRequired = { status: "storage_required" };
export interface EnterpriseMarketingCrmRepositoryRuntime {
  listMarketingCrmSyncs?(input: { context: EnterpriseTenantContext;
    campaignId: string; now: Date }): Promise<
      { status: "ready"; result: EnterpriseMarketingCrmSyncListResponse } |
      { status: "not_found" } | StorageRequired>;
  requestMarketingCrmSync?(input: { context: EnterpriseTenantContext;
    campaignId: string; outcomeId: string; expectedOutcomeVersion: number;
    idempotencyKey: string; now: Date }): Promise<
      { status: "created" | "replayed"; sync: EnterpriseMarketingCrmSyncRecord } |
      { status: "not_found" | "conflict" | "already_requested" |
        "idempotency_conflict" } |
      { status: "not_configured"; reasonCode: string } | StorageRequired>;
  finalizeMarketingCrmOutbox?(input: { context: EnterpriseTenantContext;
    eventId: string; attempt: number;
    result: { status: "completed"; receipt?: EnterpriseMarketingCrmPublishReceipt } |
      { status: "retry"; reason: string }; now: Date }): Promise<
        { status: "completed" | "retried" | "conflict" }>;
}
