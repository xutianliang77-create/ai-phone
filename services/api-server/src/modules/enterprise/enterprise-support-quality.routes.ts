import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import type {
  EnterpriseSupportQualityDetail,
  EnterpriseSupportQualityReviewRecord,
  EnterpriseSupportQualityRuleVersionRecord,
} from "./enterprise-support-quality.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseSupportQualityRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get("/enterprise/v1/support/quality/rule-versions",
    async (request, reply) => {
      const access = await authorized(request, reply, routeService, runtime,
        "quality:read", "support.quality_rule.list", "support_quality_rule_version");
      if (!access) return;
      if (!runtime.listSupportQualityRuleVersions) return postgresRequired(reply);
      const result = await runtime.listSupportQualityRuleVersions({
        context: context(request, access),
      });
      return result.status === "ready"
        ? reply.send({ ruleVersions: result.ruleVersions.map(publicRule) })
        : postgresRequired(reply);
    });

  app.post<{ Body: unknown }>("/enterprise/v1/support/quality/rule-versions",
    async (request, reply) => {
      const access = await authorized(request, reply, routeService, runtime,
        "quality:manage", "support.quality_rule.publish",
        "support_quality_rule_version");
      if (!access) return;
      const body = ruleBody(request.body);
      if (!body) return invalid(reply, "invalid_support_quality_rule");
      if (!runtime.publishSupportQualityRuleVersion) return postgresRequired(reply);
      const result = await runtime.publishSupportQualityRuleVersion({
        context: context(request, access), ...body,
        publishedAt: new Date().toISOString(),
      });
      if (result.status === "published" || result.status === "replayed") {
        return reply.code(result.status === "published" ? 201 : 200).send({
          status: result.status, ruleVersion: publicRule(result.ruleVersion),
        });
      }
      if (result.status === "storage_required") return postgresRequired(reply);
      return sendError(reply, result.status === "invalid_arguments" ? 400 : 409,
        result.status, "Support quality rule could not be published");
    });

  app.get("/enterprise/v1/support/quality/dashboard",
    async (request, reply) => {
      const access = await authorized(request, reply, routeService, runtime,
        "quality:read", "support.quality.dashboard.read", "support_quality_review");
      if (!access) return;
      if (!runtime.getSupportQualityDashboard) return postgresRequired(reply);
      const result = await runtime.getSupportQualityDashboard({
        context: context(request, access),
      });
      return result.status === "ready" ? reply.send({ dashboard: result.dashboard,
        sessions: result.sessions.map((item) => ({
          review: publicReview(item.review), findingCodes: item.findingCodes,
        })) }) : postgresRequired(reply);
    });

  app.post<{ Params: { sessionId: string } }>(
    "/enterprise/v1/support/quality/sessions/:sessionId/analyses",
    async (request, reply) => {
      const access = await authorized(request, reply, routeService, runtime,
        "quality:manage", "support.quality.analyze", "support_session",
        request.params.sessionId);
      if (!access) return;
      if (!uuid(request.params.sessionId)) {
        return invalid(reply, "invalid_support_quality_session_id");
      }
      if (!runtime.analyzeSupportQualitySession) return postgresRequired(reply);
      const result = await runtime.analyzeSupportQualitySession({
        context: context(request, access), sessionId: request.params.sessionId,
        analyzedAt: new Date().toISOString(),
      });
      if (result.status === "analyzed" || result.status === "replayed") {
        return reply.code(result.status === "analyzed" ? 201 : 200).send({
          status: result.status, review: publicReview(result.review),
        });
      }
      return qualityFailure(reply, result.status);
    });

  app.get<{ Params: { sessionId: string } }>(
    "/enterprise/v1/support/quality/sessions/:sessionId",
    async (request, reply) => {
      const access = await authorized(request, reply, routeService, runtime,
        "quality:read", "support.quality.session.read", "support_quality_review",
        request.params.sessionId);
      if (!access) return;
      if (!uuid(request.params.sessionId)) {
        return invalid(reply, "invalid_support_quality_session_id");
      }
      if (!runtime.getSupportQualitySession) return postgresRequired(reply);
      const result = await runtime.getSupportQualitySession({
        context: context(request, access), sessionId: request.params.sessionId,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return sendError(reply, 404,
        "support_quality_review_not_found", "Support quality review not found");
      return reply.send(publicDetail(result.detail));
    });
}

async function authorized(
  request: FastifyRequest, reply: FastifyReply, routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime, scope: "quality:read" | "quality:manage",
  action: string, resourceType: string, resourceId?: string,
) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope,
    { action, resourceType, ...(resourceId ? { resourceId } : {}) });
  return access && requireTenantRouteDocument(
    request, reply, routeService, access.tenant,
  ) ? access : null;
}
function context(request: FastifyRequest, access: NonNullable<Awaited<ReturnType<
  typeof requireEnterpriseScope>>>) {
  return createEnterpriseTenantContext({ tenantId: access.tenant.id,
    actorUserId: access.account.id, actorRole: access.member.role,
    traceId: enterpriseRequestTraceId(request) });
}
function ruleBody(value: unknown) {
  const body = object(value);
  if (!body || !exact(body, ["locale", "identityDisclosurePhrases",
    "prohibitedPromisePhrases", "idempotencyKey"])) return null;
  const localeValue = locale(body.locale);
  const disclosure = phraseArray(body.identityDisclosurePhrases, 1, 16);
  const prohibited = phraseArray(body.prohibitedPromisePhrases, 0, 32);
  const idempotencyKey = key(body.idempotencyKey);
  return localeValue && disclosure && prohibited && idempotencyKey
    ? { locale: localeValue, identityDisclosurePhrases: disclosure,
        prohibitedPromisePhrases: prohibited, idempotencyKey } : null;
}
function publicRule(item: EnterpriseSupportQualityRuleVersionRecord) {
  return { id: item.id, revision: item.revision, engineVersion: item.engineVersion,
    locale: item.locale,
    identityDisclosurePhrases: item.identityDisclosurePhrases,
    prohibitedPromisePhrases: item.prohibitedPromisePhrases,
    publishedAt: item.publishedAt, version: item.version };
}
function publicReview(item: EnterpriseSupportQualityReviewRecord) {
  return { id: item.id, supportSessionId: item.supportSessionId, runId: item.runId,
    ruleVersionId: item.ruleVersionId, engineVersion: item.engineVersion,
    sourceHash: item.sourceHash, status: item.status,
    semanticStatus: item.semanticStatus,
    semanticReasonCode: item.semanticReasonCode,
    evaluatedTurnCount: item.evaluatedTurnCount,
    evaluatedRuleCount: item.evaluatedRuleCount, findingCount: item.findingCount,
    criticalCount: item.criticalCount, highCount: item.highCount,
    mediumCount: item.mediumCount, analyzedAt: item.analyzedAt,
    version: item.version };
}
function publicDetail(item: EnterpriseSupportQualityDetail) {
  return { review: publicReview(item.review), ruleVersion: publicRule(item.ruleVersion),
    findings: item.findings.map((finding) => ({ id: finding.id,
      turnId: finding.turnId, turnSequence: finding.turnSequence,
      code: finding.code, severity: finding.severity,
      evidenceHash: finding.evidenceHash, createdAt: finding.createdAt })),
    session: item.session, run: item.run,
    turns: item.turns.map((turn) => ({ id: turn.id, sequence: turn.sequence,
      status: turn.status, output: turn.output ? {
        spokenText: turn.output.spokenText, intent: turn.output.intent,
        riskSignals: turn.output.riskSignals,
        knowledgeCitations: turn.output.knowledgeCitations,
        conversationState: turn.output.conversationState,
      } : undefined, failureCode: turn.failureCode,
      evidenceHash: turn.evidenceHash, deliveredAt: turn.deliveredAt,
      createdAt: turn.createdAt, updatedAt: turn.updatedAt, version: turn.version })),
    transcriptSegments: item.transcriptSegments,
    toolExecutions: item.toolExecutions.map((execution) => ({ id: execution.id,
      toolName: execution.toolName, riskLevel: execution.riskLevel,
      confirmationStatus: execution.confirmationStatus, status: execution.status,
      failureCode: execution.failureCode, createdAt: execution.createdAt,
      completedAt: execution.completedAt })) };
}
function qualityFailure(reply: FastifyReply, status: string) {
  if (status === "storage_required") return postgresRequired(reply);
  if (status === "not_found") return sendError(reply, 404, status,
    "Support session not found");
  const messages: Record<string, string> = {
    not_finalized: "Support session must be terminal before analysis",
    rule_not_configured: "Support quality rule is not configured for this locale",
    no_agent_data: "Terminal Support Agent evidence is not available",
    conflict: "Support quality analysis conflicted with current evidence",
  };
  return sendError(reply, 409, status, messages[status] ??
    "Support quality analysis is unavailable");
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
    ? value as Record<string, unknown> : null;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function phraseArray(value: unknown, min: number, max: number) {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const items = value.map((item) => phrase(item));
  if (items.some((item) => !item)) return null;
  const normalized = items.map((item) => item!.normalize("NFKC").toLowerCase()
    .replace(/\s+/gu, " ").trim());
  return new Set(normalized).size === normalized.length ? items as string[] : null;
}
function phrase(value: unknown) { return typeof value === "string" && value === value.trim() &&
  Buffer.byteLength(value) >= 1 && Buffer.byteLength(value) <= 240 ? value : null; }
function locale(value: unknown) {
  if (value === "*") return value;
  if (typeof value !== "string" ||
    !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) return null;
  try { return Intl.getCanonicalLocales(value)[0] ?? null; }
  catch { return null; }
}
function key(value: unknown) { return typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) ? value : null; }
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function invalid(reply: FastifyReply, code: string) {
  return sendError(reply, 400, code, "Invalid Support quality request");
}
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "Enterprise PostgreSQL runtime required"); }
