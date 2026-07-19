import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type { EnterpriseCampaignRecord } from "./enterprise-campaign.js";
import type { EnterpriseMarketingClaimedTask,
  EnterpriseMarketingSchedulerStatusRecord } from
  "./enterprise-marketing-scheduler.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseMarketingSchedulerRepositoryRuntime {
  getMarketingSchedulerStatus?(input: { context: EnterpriseTenantContext;
    campaignId: string }): Promise<{ status: "ready"; campaign: EnterpriseCampaignRecord;
      scheduler: EnterpriseMarketingSchedulerStatusRecord;
      tenantConcurrencyLimit?: number; budgetStatus: "ready" | "not_configured" | "paused";
    } | { status: "not_found" } | StorageRequired>;
  claimMarketingSchedulerTasks?(input: { tenantId: string; homeRegion: string;
    cellId: string; routeEpoch: number; schedulerId: string; batchSize: number;
    traceId: string; now: Date; leaseSeconds: number; holdSeconds: number }): Promise<{
      status: "claimed" | "empty"; tasks: EnterpriseMarketingClaimedTask[];
      capacitySkipped: number;
      budgetBlocked?: "not_configured" | "paused" | "exhausted";
    } | { status: "route_mismatch" | "entitlement_unavailable" |
      "entitlement_denied" } | StorageRequired>;
}
