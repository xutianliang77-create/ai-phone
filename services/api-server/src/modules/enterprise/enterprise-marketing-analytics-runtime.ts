import type { EnterpriseMarketingAnalyticsResponse } from "@translation/contracts";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

export interface EnterpriseMarketingAnalyticsRepositoryRuntime {
  getMarketingAnalytics?(input: {
    context: EnterpriseTenantContext;
    campaignId: string;
    now: Date;
  }): Promise<
    | { status: "ready"; analytics: EnterpriseMarketingAnalyticsResponse }
    | { status: "not_found" }
    | { status: "storage_required" }
  >;
}
