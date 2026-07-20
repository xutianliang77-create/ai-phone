import type { EnterpriseMarketingMonitoringRepositoryRuntime } from
  "../../modules/enterprise/enterprise-marketing-monitoring-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";
import { enterpriseMarketingHandoffEvidenceDto } from
  "../../modules/enterprise/enterprise-marketing-handoff.js";

type Runtime = Required<EnterpriseMarketingMonitoringRepositoryRuntime>;

export function createEnterprisePostgresMarketingMonitoringRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    getMarketingMonitoringSnapshot(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const snapshot = await unit.marketingMonitoring.snapshot(
          input.campaignId,
          input.now,
        );
        return snapshot
          ? { status: "ready" as const, snapshot }
          : { status: "not_found" as const };
      });
    },
    getMarketingMonitoringCall(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const detail = await unit.marketingMonitoring.call(
          input.campaignId,
          input.dispatchId,
          input.now,
        );
        const handoff = detail
          ? await unit.marketingHandoffs.findByDispatch(input.dispatchId) : null;
        return detail
          ? { status: "ready" as const, detail: { ...detail,
              ...(handoff
                ? { handoff: enterpriseMarketingHandoffEvidenceDto(handoff) } : {}) } }
          : { status: "not_found" as const };
      });
    },
  };
}
