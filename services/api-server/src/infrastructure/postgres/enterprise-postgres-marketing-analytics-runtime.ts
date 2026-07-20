import type { EnterpriseMarketingAnalyticsRepositoryRuntime } from
  "../../modules/enterprise/enterprise-marketing-analytics-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Required<EnterpriseMarketingAnalyticsRepositoryRuntime>;

export function createEnterprisePostgresMarketingAnalyticsRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    getMarketingAnalytics(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const analytics = await unit.marketingAnalytics.analytics(
          input.campaignId,
          input.now,
        );
        return analytics ? { status: "ready" as const, analytics }
          : { status: "not_found" as const };
      }, { readOnlyRepeatableRead: true });
    },
  };
}
