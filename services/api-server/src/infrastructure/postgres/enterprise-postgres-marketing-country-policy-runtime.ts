import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseMarketingCountryPolicyRepositoryRuntime } from
  "../../modules/enterprise/enterprise-marketing-country-policy-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Required<EnterpriseMarketingCountryPolicyRepositoryRuntime>;

export function createEnterprisePostgresMarketingCountryPolicyRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    publishCountryPolicy(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.marketingCountryPolicies.publish(input.policy);
        if (result.status === "created") await unit.tenant.appendAuditEvent(
          createEnterpriseAuditEvent({ context: input.context,
            action: "campaign.country_policy_publish",
            resourceType: "marketing_country_policy",
            resourceId: result.policy.id, result: "completed",
            details: { countryCode: result.policy.countryCode,
              policyVersion: result.policy.policyVersion,
              contentHash: result.policy.contentHash,
              effectiveFrom: result.policy.effectiveFrom,
              expiresAt: result.policy.expiresAt },
            createdAt: result.policy.publishedAt }),
        );
        return result;
      });
    },
    listCountryPolicies(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => ({
        status: "ready" as const,
        policies: await unit.marketingCountryPolicies.list(),
      }));
    },
    resolveCampaignCountryPolicies(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, (unit) =>
        unit.marketingCountryPolicies.resolveCampaign(
          input.campaignId, input.evaluatedAt,
        ));
    },
  };
}
