import type { EnterpriseCountryPolicyRecord } from
  "./enterprise-marketing-country-policy.js";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseMarketingCountryPolicyRepositoryRuntime {
  publishCountryPolicy?(input: {
    context: EnterpriseTenantContext;
    policy: Omit<EnterpriseCountryPolicyRecord, "tenantId" | "version"> & {
      idempotencyKey: string;
    };
  }): Promise<
    | { status: "created" | "replayed"; policy: EnterpriseCountryPolicyRecord }
    | { status: "idempotency_conflict" | "policy_version_conflict" |
        "effective_window_conflict" }
    | StorageRequired
  >;
  listCountryPolicies?(input: {
    context: EnterpriseTenantContext;
  }): Promise<
    | { status: "ready"; policies: EnterpriseCountryPolicyRecord[] }
    | StorageRequired
  >;
  resolveCampaignCountryPolicies?(input: {
    context: EnterpriseTenantContext;
    campaignId: string;
    evaluatedAt: string;
  }): Promise<
    | { status: "ready" | "blocked"; targetAt: string;
        policies: EnterpriseCountryPolicyRecord[];
        issues: Array<{ countryCode: string; reasonCode:
          "country_policy_missing" | "country_policy_not_yet_effective" |
          "country_policy_expired" }> }
    | { status: "not_found" }
    | StorageRequired
  >;
}
