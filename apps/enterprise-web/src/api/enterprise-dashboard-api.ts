import type { EnterpriseDashboardBusinessSummaryResponse } from
  "@translation/contracts";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";

type Requester = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface EnterpriseDashboardApi {
  getEnterpriseDashboardBusinessSummary(
    context: EnterpriseContentRequestContext,
  ): Promise<EnterpriseDashboardBusinessSummaryResponse>;
}

export function createEnterpriseDashboardApi(
  request: Requester,
  headers: (context: EnterpriseContentRequestContext) => Record<string, string>,
): EnterpriseDashboardApi {
  return {
    getEnterpriseDashboardBusinessSummary: (context) => request(
      "/enterprise/v1/dashboard/business-summary",
      { headers: headers(context) },
    ),
  };
}
