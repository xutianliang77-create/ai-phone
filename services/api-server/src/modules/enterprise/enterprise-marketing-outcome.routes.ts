import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CreateEnterpriseMarketingOutcomeRequest } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from "./enterprise-auth.js";
import {
  enterpriseMarketingDispositions,
  enterpriseMarketingIntentLevels,
  enterpriseMarketingNextActionKinds,
  enterpriseMarketingOutcomeHash,
  validEnterpriseMarketingOutcomeCombination,
} from "./enterprise-marketing-outcome.js";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseMarketingOutcomeRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get<{ Params: { campaignId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/outcomes",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      if (!campaignId) return invalid(reply);
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:read", "marketing.outcome.list", campaignId);
      if (!access) return;
      if (!runtime.listMarketingOutcomes) return postgresRequired(reply);
      const result = await runtime.listMarketingOutcomes({
        context: context(request, access), campaignId, now: new Date(),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      return reply.send(result.result);
    },
  );

  app.post<{ Params: { campaignId: string }; Body: unknown }>(
    "/enterprise/v1/campaigns/:campaignId/outcomes",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      const body = outcomeBody(request.body);
      const idempotencyKey = commandKey(request);
      if (!campaignId || !body || !idempotencyKey) return invalid(reply);
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:write", "marketing.outcome.create", campaignId);
      if (!access) return;
      if (body.tenantId && body.tenantId !== access.tenant.id) return mismatch(reply);
      if (!runtime.createMarketingOutcome) return postgresRequired(reply);
      const common = { actorUserId: access.account.id, campaignId,
        dispatchId: body.dispatchId, disposition: body.disposition,
        intentLevel: body.intentLevel, summary: body.summary,
        evidence: body.evidence, ...(body.nextAction
          ? { nextAction: body.nextAction } : {}) };
      const result = await runtime.createMarketingOutcome({
        context: context(request, access), campaignId,
        outcomeId: randomUUID(), nextActionId: randomUUID(),
        dispatchId: body.dispatchId, disposition: body.disposition,
        intentLevel: body.intentLevel, summary: body.summary,
        evidence: body.evidence, ...(body.nextAction
          ? { nextAction: body.nextAction } : {}),
        idempotencyKey, requestHash: enterpriseMarketingOutcomeHash(common),
        occurredAt: new Date().toISOString(),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "evidence_invalid") return sendError(reply, 422,
        result.reasonCode ?? "marketing_outcome_evidence_invalid",
        "Marketing outcome evidence is invalid");
      if (result.status === "not_ready" || result.status === "already_finalized" ||
        result.status === "idempotency_conflict") return conflict(reply, result.reasonCode ??
          `marketing_outcome_${result.status}`);
      if (!("outcome" in result)) return conflict(reply, "marketing_outcome_conflict");
      return reply.code(result.status === "created" ? 201 : 200).send({
        status: result.status, outcome: result.outcome,
      });
    },
  );
}

async function authorized(request: FastifyRequest, reply: FastifyReply,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime,
  scope: "campaign:read" | "campaign:write", action: string, resourceId: string) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope,
    { action, resourceType: "marketing_outcome", resourceId });
  return access && requireTenantRouteDocument(request, reply, routeService, access.tenant)
    ? access : null;
}
function context(request: FastifyRequest, access: NonNullable<Awaited<ReturnType<
  typeof requireEnterpriseScope>>>) { return createEnterpriseTenantContext({
  tenantId: access.tenant.id, actorUserId: access.account.id,
  actorRole: access.member.role, traceId: enterpriseRequestTraceId(request) }); }

function outcomeBody(value: unknown): CreateEnterpriseMarketingOutcomeRequest | null {
  const body = object(value);
  if (!body || !exact(body, ["tenantId", "dispatchId", "disposition",
    "intentLevel", "summary", "evidence", "nextAction"])) return null;
  const tenantId = optionalUuid(body.tenantId); const dispatchId = uuid(body.dispatchId);
  const disposition = enterpriseMarketingDispositions.find((item) =>
    item === body.disposition); const intentLevel = enterpriseMarketingIntentLevels.find(
    (item) => item === body.intentLevel); const summary = bounded(body.summary, 2_000);
  const evidence = evidenceRefs(body.evidence); const nextAction = next(body.nextAction);
  if (tenantId === null || !dispatchId || !disposition || !intentLevel || !summary ||
    !evidence || nextAction === null || !validEnterpriseMarketingOutcomeCombination({
      disposition, intentLevel, ...(nextAction ? { nextAction } : {}) })) return null;
  return { ...(tenantId ? { tenantId } : {}), dispatchId, disposition, intentLevel,
    summary, evidence, ...(nextAction ? { nextAction } : {}) };
}
function evidenceRefs(value: unknown) {
  if (!Array.isArray(value) || value.length > 16) return null;
  const result = value.map((item) => { const ref = object(item);
    if (!ref || !exact(ref, ["type", "id"]) ||
      !["transcript_segment", "agent_turn"].includes(String(ref.type))) return null;
    const id = uuid(ref.id); return id ? { type: ref.type as
      "transcript_segment" | "agent_turn", id } : null; });
  return result.every(Boolean) ? result as NonNullable<(typeof result)[number]>[] : null;
}
function next(value: unknown) {
  if (value === undefined) return undefined;
  const item = object(value); if (!item || !exact(item, ["kind", "dueAt"])) return null;
  const kind = enterpriseMarketingNextActionKinds.find((candidate) =>
    candidate === item.kind); const dueAt = optionalIso(item.dueAt);
  return !kind || dueAt === null ? null : { kind, ...(dueAt ? { dueAt } : {}) };
}
function object(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) ===
  Object.prototype ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key)); }
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value) ? value : null; }
function optionalUuid(value: unknown) { return value === undefined ? undefined : uuid(value); }
function bounded(value: unknown, max: number) { if (typeof value !== "string") return null;
  const result = value.trim(); return result && Buffer.byteLength(result) <= max
    ? result : null; }
function optionalIso(value: unknown) { if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 40) return null;
  const parsed = Date.parse(value); return Number.isFinite(parsed)
    ? new Date(parsed).toISOString() : null; }
function commandKey(request: FastifyRequest) { const value = request.headers["idempotency-key"];
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
    ? value : null; }
function invalid(reply: FastifyReply) { return sendError(reply, 400,
  "invalid_marketing_outcome_request", "Invalid marketing outcome request"); }
function conflict(reply: FastifyReply, code: string) { return sendError(reply, 409,
  code, "Marketing outcome conflict"); }
function mismatch(reply: FastifyReply) { return sendError(reply, 409,
  "tenant_context_mismatch", "Tenant context mismatch"); }
function notFound(reply: FastifyReply) { return sendError(reply, 404,
  "marketing_outcome_not_found", "Marketing outcome resource not found"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "PostgreSQL enterprise runtime required"); }
