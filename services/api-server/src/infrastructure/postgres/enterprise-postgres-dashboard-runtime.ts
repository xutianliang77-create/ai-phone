import type { EnterpriseDashboardRepositoryRuntime } from
  "../../modules/enterprise/enterprise-dashboard-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Required<EnterpriseDashboardRepositoryRuntime>;

export function createEnterprisePostgresDashboardRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    getEnterpriseDashboardBusinessSummary(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const generatedAt = await unit.dashboard.generatedAt();
        const marketing = input.includeMarketing
          ? await unit.dashboard.marketing() : { status: "forbidden" as const };
        const support = input.includeSupport
          ? await unit.dashboard.support(generatedAt) : { status: "forbidden" as const };
        const meetings = input.includeMeetings
          ? await unit.dashboard.meetings() : { status: "forbidden" as const };
        return { status: "ready" as const,
          summary: { generatedAt, marketing, support, meetings } };
      }, { readOnlyRepeatableRead: true });
    },
  };
}
