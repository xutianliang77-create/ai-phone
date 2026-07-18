import type {
  ChangeEnterpriseSubscriptionRequest,
  ConfigureEnterpriseUsageBudgetRequest,
  EnterpriseEntitlementsResponse,
  EnterpriseProviderCapabilitiesResponse,
  EnterpriseUsageBudgetsResponse,
  EnterpriseUsageCategory,
  EnterpriseUsagePeriodAggregatesResponse,
  EnterpriseUsageBudgetDto,
} from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";

type EnterpriseRequester = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface EnterpriseSettingsApi {
  getProviderCapabilities(
    token: string,
    tenantId: string,
  ): Promise<EnterpriseProviderCapabilitiesResponse>;
  getBillingEntitlements(
    context: EnterpriseContentRequestContext,
  ): Promise<EnterpriseEntitlementsResponse>;
  changeSubscription(
    context: EnterpriseContentRequestContext,
    input: Omit<ChangeEnterpriseSubscriptionRequest, "tenantId">,
  ): Promise<EnterpriseEntitlementsResponse>;
  listUsageBudgets(
    context: EnterpriseContentRequestContext,
  ): Promise<EnterpriseUsageBudgetsResponse>;
  configureUsageBudget(
    context: EnterpriseContentRequestContext,
    category: EnterpriseUsageCategory,
    input: Omit<ConfigureEnterpriseUsageBudgetRequest, "tenantId">,
  ): Promise<{ budget: EnterpriseUsageBudgetDto }>;
  listUsageAggregates(
    context: EnterpriseContentRequestContext,
  ): Promise<EnterpriseUsagePeriodAggregatesResponse>;
}

export function createEnterpriseSettingsApi(
  request: EnterpriseRequester,
  headers: (context: EnterpriseContentRequestContext) => Record<string, string>,
): EnterpriseSettingsApi {
  return {
    getProviderCapabilities: (token, tenantId) => request(
      "/enterprise/v1/provider-capabilities",
      { headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId } },
    ),
    getBillingEntitlements: (context) => request(
      `/saas/v1/tenants/${encodeURIComponent(context.tenantId)}/entitlements`,
      { headers: headers(context) },
    ),
    changeSubscription: (context, input) => request(
      `/saas/v1/tenants/${encodeURIComponent(context.tenantId)}/subscription/change`,
      { method: "POST", headers: headers(context), body: JSON.stringify(input) },
    ),
    listUsageBudgets: (context) => request("/enterprise/v1/usage/budgets", {
      headers: headers(context),
    }),
    configureUsageBudget: (context, category, input) => request(
      `/enterprise/v1/usage/budgets/${encodeURIComponent(category)}`,
      { method: "PUT", headers: headers(context), body: JSON.stringify(input) },
    ),
    listUsageAggregates: (context) => request("/enterprise/v1/usage/aggregates", {
      headers: headers(context),
    }),
  };
}
