import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import { enterpriseMarketingOutcomeDto } from
  "../../modules/enterprise/enterprise-marketing-outcome.js";
import type { EnterpriseMarketingOutcomeRepositoryRuntime } from
  "../../modules/enterprise/enterprise-marketing-outcome-runtime.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";

type Runtime = Required<EnterpriseMarketingOutcomeRepositoryRuntime>;

export function createEnterprisePostgresMarketingOutcomeRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    listMarketingOutcomes(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        if (!await unit.campaigns.find(input.campaignId)) {
          return { status: "not_found" as const };
        }
        const result = await unit.marketingOutcomes.list(input.campaignId, 101);
        const outcomes = result.records.slice(0, 100).map(enterpriseMarketingOutcomeDto);
        return { status: "ready" as const, result: {
          campaignId: input.campaignId, generatedAt: input.now.toISOString(),
          counts: { finalized: result.finalized,
            nextActionRequested: result.nextActionRequested },
          outcomes, truncated: result.records.length > 100,
        } };
      });
    },
    createMarketingOutcome(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        if (!await unit.campaigns.find(input.campaignId)) {
          return { status: "not_found" as const };
        }
        const result = await unit.marketingOutcomes.create({
          outcomeId: input.outcomeId, nextActionId: input.nextActionId,
          campaignId: input.campaignId, dispatchId: input.dispatchId,
          actorUserId: input.context.actorUserId,
          idempotencyKey: input.idempotencyKey, requestHash: input.requestHash,
          disposition: input.disposition, intentLevel: input.intentLevel,
          summary: input.summary, evidence: input.evidence,
          ...(input.nextAction ? { nextAction: input.nextAction } : {}),
          occurredAt: input.occurredAt,
        });
        if (!("outcome" in result) || !result.outcome) return result;
        const outcome = result.outcome;
        if (result.status === "created") await unit.tenant.appendAuditEvent(
          createEnterpriseAuditEvent({ context: input.context,
            action: "marketing.outcome.created", resourceType: "marketing_outcome",
            resourceId: outcome.id, result: "completed",
            details: { campaignId: input.campaignId,
              taskId: outcome.taskId, dispatchId: outcome.dispatchId,
              disposition: outcome.disposition,
              intentLevel: outcome.intentLevel,
              evidenceHash: outcome.evidenceHash,
              sourceHash: outcome.sourceHash,
              nextAction: outcome.nextAction?.kind ?? "none",
              externalAction: "not_executed" }, createdAt: input.occurredAt }));
        return { status: result.status, outcome: enterpriseMarketingOutcomeDto(outcome) };
      });
    },
  };
}
