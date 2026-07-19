import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseMarketingSuppressionRepositoryRuntime } from
  "../../modules/enterprise/enterprise-marketing-suppression-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Required<EnterpriseMarketingSuppressionRepositoryRuntime>;

export function createEnterprisePostgresMarketingSuppressionRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    createMarketingSuppression(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.marketingSuppressions.create(input.suppression);
        if (result.status === "created") await unit.tenant.appendAuditEvent(
          createEnterpriseAuditEvent({ context: input.context,
            action: "campaign.suppression_create",
            resourceType: "marketing_suppression",
            resourceId: result.suppression.id, result: "completed",
            details: { campaignId: input.suppression.campaignId,
              leadId: result.suppression.leadId,
              scope: result.suppression.scope, source: result.suppression.source,
              cancelledTaskCount: result.suppression.cancelledTaskCount },
            createdAt: result.suppression.createdAt }),
        );
        return result;
      });
    },
    listMarketingSuppressions(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const suppressions = await unit.marketingSuppressions.list(
          input.campaignId, input.leadId,
        );
        return suppressions ? { status: "ready" as const, suppressions }
          : { status: "not_found" as const };
      });
    },
    resolveMarketingSuppression(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, (unit) =>
        unit.marketingSuppressions.resolve(input.campaignId, input.leadId));
    },
  };
}
