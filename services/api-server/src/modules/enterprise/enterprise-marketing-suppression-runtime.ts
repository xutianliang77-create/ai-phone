import type { EnterpriseMarketingSuppressionSource } from "@translation/contracts";
import type { EnterpriseMarketingSuppressionRecord } from
  "./enterprise-marketing-suppression.js";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseMarketingSuppressionRepositoryRuntime {
  createMarketingSuppression?(input: {
    context: EnterpriseTenantContext;
    suppression: {
      id: string;
      campaignId: string;
      leadId: string;
      scope: "tenant";
      source: Exclude<EnterpriseMarketingSuppressionSource, "global_registry">;
      reason: string;
      sourceReference: string;
      idempotencyKey: string;
      requestHash: string;
      createdAt: string;
    };
  }): Promise<
    | { status: "created" | "replayed" | "already_suppressed";
        suppression: EnterpriseMarketingSuppressionRecord }
    | { status: "not_found" | "idempotency_conflict" }
    | StorageRequired
  >;
  listMarketingSuppressions?(input: {
    context: EnterpriseTenantContext;
    campaignId: string;
    leadId: string;
  }): Promise<
    | { status: "ready"; suppressions: EnterpriseMarketingSuppressionRecord[] }
    | { status: "not_found" }
    | StorageRequired
  >;
  resolveMarketingSuppression?(input: {
    context: EnterpriseTenantContext;
    campaignId: string;
    leadId: string;
  }): Promise<
    | { status: "eligible" }
    | { status: "blocked"; suppression: EnterpriseMarketingSuppressionRecord }
    | { status: "not_found" }
    | StorageRequired
  >;
}
