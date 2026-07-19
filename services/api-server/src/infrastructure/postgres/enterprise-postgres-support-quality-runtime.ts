import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseSupportQualityRepositoryRuntime } from
  "../../modules/enterprise/enterprise-support-quality-runtime.js";
import {
  enterpriseSupportQualityEngineVersion,
  enterpriseSupportQualityHash,
  evaluateEnterpriseSupportQuality,
  stableSupportQualityUuid,
} from "../../modules/enterprise/enterprise-support-quality.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Required<EnterpriseSupportQualityRepositoryRuntime>;
const semanticReasonCode = "support_quality_semantic_model_not_configured";

export function createEnterprisePostgresSupportQualityRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    publishSupportQualityRuleVersion(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const requestHash = enterpriseSupportQualityHash({ locale: input.locale,
          identityDisclosurePhrases: input.identityDisclosurePhrases,
          prohibitedPromisePhrases: input.prohibitedPromisePhrases,
          engineVersion: enterpriseSupportQualityEngineVersion });
        const prior = await unit.supportQuality.findRuleByKey(
          input.idempotencyKey, true,
        );
        if (prior) return prior.requestHash === requestHash
          ? { status: "replayed" as const, ruleVersion: prior }
          : { status: "idempotency_conflict" as const };
        const id = stableSupportQualityUuid(`${input.context.tenantId}:quality-rule:${
          input.idempotencyKey}`);
        const ruleVersion = await unit.supportQuality.createRuleVersion({ id,
          engineVersion: enterpriseSupportQualityEngineVersion, locale: input.locale,
          identityDisclosurePhrases: input.identityDisclosurePhrases,
          prohibitedPromisePhrases: input.prohibitedPromisePhrases,
          idempotencyKey: input.idempotencyKey, requestHash,
          publishedBy: input.context.actorUserId, publishedAt: input.publishedAt });
        if (!ruleVersion) {
          const replay = await unit.supportQuality.findRuleByKey(
            input.idempotencyKey, true,
          );
          return replay?.requestHash === requestHash
            ? { status: "replayed" as const, ruleVersion: replay }
            : { status: "idempotency_conflict" as const };
        }
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "support.quality_rule.publish",
          resourceType: "support_quality_rule_version", resourceId: ruleVersion.id,
          result: "completed", details: { revision: ruleVersion.revision,
            locale: ruleVersion.locale, engineVersion: ruleVersion.engineVersion,
            disclosurePhraseCount: ruleVersion.identityDisclosurePhrases.length,
            prohibitedPhraseCount: ruleVersion.prohibitedPromisePhrases.length,
            requestHash }, createdAt: input.publishedAt,
        }));
        return { status: "published" as const, ruleVersion };
      });
    },

    async listSupportQualityRuleVersions(input) {
      const ruleVersions = await withEnterprisePostgresUnitOfWork(
        pool, input.context, (unit) => unit.supportQuality.listRuleVersions(),
      );
      return { status: "ready", ruleVersions };
    },

    analyzeSupportQualitySession(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const analyzedAt = exactTimestamp(input.analyzedAt);
        const session = await unit.support.findSession(input.sessionId, true);
        if (!session) return { status: "not_found" as const };
        if (!sessionFinal(session.status)) return { status: "not_finalized" as const };
        const run = await unit.supportAgents.findLatestRunForSession(session.id, true);
        if (!run || !runFinal(run.status)) return { status: "no_agent_data" as const };
        const rule = await unit.supportQuality.resolveRule(run.locale);
        if (!rule) return { status: "rule_not_configured" as const };
        const turns = await unit.supportAgents.listTurnsForRun(run.id);
        const sourceHash = enterpriseSupportQualityHash({ session: {
          id: session.id, status: session.status, version: session.version,
          updatedAt: session.updatedAt }, run: { id: run.id, status: run.status,
          version: run.version, locale: run.locale, updatedAt: run.updatedAt },
          turns: turns.map((turn) => ({ id: turn.id, sequence: turn.sequence,
            status: turn.status, version: turn.version, evidenceHash: turn.evidenceHash,
            output: turn.output, failureCode: turn.failureCode,
            deliveredAt: turn.deliveredAt })) });
        const prior = await unit.supportQuality.findReview(
          session.id, rule.id, sourceHash,
        );
        if (prior) return { status: "replayed" as const, review: prior };
        const reviewId = stableSupportQualityUuid(`${input.context.tenantId}:quality:${
          session.id}:${rule.id}:${sourceHash}`);
        const evaluated = evaluateEnterpriseSupportQuality({
          tenantId: input.context.tenantId, supportSessionId: session.id,
          runId: run.id, reviewId, rule, turns, createdAt: analyzedAt,
        });
        if (!evaluated) return { status: "no_agent_data" as const };
        const counts = findingCounts(evaluated.findings);
        const review = await unit.supportQuality.createReview({ review: {
          id: reviewId, tenantId: input.context.tenantId,
          supportSessionId: session.id, runId: run.id, ruleVersionId: rule.id,
          engineVersion: enterpriseSupportQualityEngineVersion, sourceHash,
          status: "partial", semanticStatus: "not_configured",
          semanticReasonCode, evaluatedTurnCount: evaluated.evaluatedTurnCount,
          evaluatedRuleCount: evaluated.evaluatedRuleCount,
          findingCount: evaluated.findings.length, ...counts,
          analyzedBy: input.context.actorUserId, analyzedAt,
          createdAt: analyzedAt, version: 1,
        }, findings: evaluated.findings });
        if (!review) {
          const replay = await unit.supportQuality.findReview(
            session.id, rule.id, sourceHash,
          );
          return replay ? { status: "replayed" as const, review: replay }
            : { status: "conflict" as const };
        }
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "support.quality.analyze",
          resourceType: "support_quality_review", resourceId: review.id,
          result: "completed", details: { sessionId: session.id, runId: run.id,
            ruleVersionId: rule.id, sourceHash, findingCount: review.findingCount,
            criticalCount: review.criticalCount, highCount: review.highCount,
            mediumCount: review.mediumCount, semanticStatus: review.semanticStatus,
            semanticReasonCode }, createdAt: analyzedAt,
        }));
        return { status: "analyzed" as const, review };
      });
    },

    getSupportQualityDashboard(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => ({
        status: "ready" as const,
        dashboard: await unit.supportQuality.dashboard(),
        sessions: await unit.supportQuality.listLatestReviews(),
      }));
    },

    getSupportQualitySession(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const review = await unit.supportQuality.latestReview(input.sessionId);
        if (!review) return { status: "not_found" as const };
        const [ruleVersion, session, run, findings] = await Promise.all([
          unit.supportQuality.findRule(review.ruleVersionId),
          unit.support.findSession(review.supportSessionId),
          unit.supportAgents.findRun(review.runId),
          unit.supportQuality.listFindings(review.id),
        ]);
        if (!ruleVersion || !session || !run) {
          throw new Error("Support quality evidence binding is incomplete");
        }
        const [turns, transcriptSegments, toolExecutions] = await Promise.all([
          unit.supportAgents.listTurnsForRun(run.id),
          unit.supportWorkbench.listTranscriptSegments(run.communicationSessionId),
          unit.supportToolExecutions.list(session.id),
        ]);
        return { status: "ready" as const, detail: { review, ruleVersion,
          findings, session: { id: session.id, status: session.status,
            createdAt: session.createdAt, updatedAt: session.updatedAt,
            ...(session.endedAt ? { endedAt: session.endedAt } : {}) },
          run: { id: run.id, status: run.status, locale: run.locale,
            generation: run.generation }, turns, transcriptSegments,
          toolExecutions } };
      });
    },
  };
}

function findingCounts(findings: Array<{ severity: string }>) {
  return { criticalCount: findings.filter((item) => item.severity === "critical").length,
    highCount: findings.filter((item) => item.severity === "high").length,
    mediumCount: findings.filter((item) => item.severity === "medium").length };
}
function sessionFinal(value: string) { return value === "ended" || value === "failed"; }
function runFinal(value: string) {
  return value === "completed" || value === "failed" || value === "cancelled";
}
function exactTimestamp(value: string) {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("Invalid support quality analysis time");
  }
  return value;
}
