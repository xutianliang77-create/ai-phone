import type { EnterpriseDashboardBusinessSummaryResponse } from
  "@translation/contracts";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseDashboardRepositoryRuntime {
  getEnterpriseDashboardBusinessSummary?(input: {
    context: EnterpriseTenantContext;
    includeMarketing: boolean;
    includeSupport: boolean;
    includeMeetings: boolean;
  }): Promise<
    | { status: "ready"; summary: EnterpriseDashboardBusinessSummaryResponse }
    | StorageRequired
  >;
}
