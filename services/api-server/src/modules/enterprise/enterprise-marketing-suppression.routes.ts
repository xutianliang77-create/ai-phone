import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateEnterpriseMarketingSuppressionRequest,
  EnterpriseMarketingSuppressionSource,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import type { EnterpriseGlobalSuppressionRegistry } from
  "./enterprise-global-suppression-registry.js";
import { marketingSuppressionCreationHash, marketingSuppressionDto } from
  "./enterprise-marketing-suppression.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseMarketingSuppressionRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  globalRegistry: EnterpriseGlobalSuppressionRegistry,
) {
  app.get<{ Params: { campaignId: string; leadId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/leads/:leadId/suppressions",
    async (request, reply) => {
      const params = routeParams(request.params);
      if (!params) return invalid(reply, "invalid_marketing_suppression_scope");
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:read", "campaign.suppressions_list", params.leadId);
      if (!access) return;
      if (!runtime.listMarketingSuppressions) return postgresRequired(reply);
      const result = await runtime.listMarketingSuppressions({
        context: context(request, access), ...params,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      return reply.send({ evaluatedAt: new Date().toISOString(),
        suppressions: result.suppressions.map(marketingSuppressionDto),
        globalRegistry: globalRegistry.readiness() });
    },
  );

  app.get<{ Params: { campaignId: string; leadId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/leads/:leadId/suppression-eligibility",
    async (request, reply) => {
      const params = routeParams(request.params);
      if (!params) return invalid(reply, "invalid_marketing_suppression_scope");
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:read", "campaign.suppression_eligibility", params.leadId);
      if (!access) return;
      if (!runtime.resolveMarketingSuppression) return postgresRequired(reply);
      const result = await runtime.resolveMarketingSuppression({
        context: context(request, access), ...params,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      const evaluatedAt = new Date().toISOString();
      const globalRegistryReadiness = globalRegistry.readiness();
      if (result.status === "blocked") return reply.send({ status: "blocked",
        evaluatedAt, reasonCode: result.suppression.scope === "global"
          ? "global_suppressed" : "tenant_suppressed",
        suppression: marketingSuppressionDto(result.suppression),
        globalRegistry: globalRegistryReadiness });
      if (globalRegistryReadiness.status !== "ready") return reply.send({
        status: "not_ready", evaluatedAt,
        reasonCode: globalRegistryReadiness.status === "degraded"
          ? "global_suppression_registry_degraded"
          : "global_suppression_registry_not_configured",
        globalRegistry: globalRegistryReadiness,
      });
      return reply.send({ status: "eligible", evaluatedAt,
        globalRegistry: globalRegistryReadiness });
    },
  );

  app.post<{ Body: unknown }>(
    "/enterprise/v1/suppression",
    async (request, reply) => {
      const body = suppressionBody(request.body);
      if (!body) return invalid(reply, "invalid_marketing_suppression");
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:write", "campaign.suppression_create", body.leadId);
      if (!access) return;
      if (body.tenantId && body.tenantId !== access.tenant.id) return mismatch(reply);
      const key = idempotencyKey(request);
      if (!key) return invalid(reply, "idempotency_key_required");
      if (!runtime.createMarketingSuppression) return postgresRequired(reply);
      const requestHash = marketingSuppressionCreationHash({
        actorUserId: access.account.id, campaignId: body.campaignId,
        leadId: body.leadId, scope: body.scope, source: body.source,
        reason: body.reason, sourceReference: body.sourceReference,
      });
      const result = await runtime.createMarketingSuppression({
        context: context(request, access), suppression: { id: randomUUID(),
          campaignId: body.campaignId, leadId: body.leadId, scope: body.scope,
          source: body.source, reason: body.reason,
          sourceReference: body.sourceReference, idempotencyKey: key,
          requestHash, createdAt: new Date().toISOString() },
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "idempotency_conflict") return conflict(reply);
      if (!("suppression" in result)) return conflict(reply);
      return reply.code(result.status === "created" ? 201 : 200).send({
        status: result.status,
        suppression: marketingSuppressionDto(result.suppression),
      });
    },
  );
}

async function authorized(request: FastifyRequest, reply: FastifyReply,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime,
  scope: "campaign:read" | "campaign:write", action: string, resourceId: string) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope,
    { action, resourceType: "marketing_suppression", resourceId });
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
function suppressionBody(value: unknown): CreateEnterpriseMarketingSuppressionRequest | null {
  const body = object(value);
  if (!body || !exact(body, ["tenantId", "campaignId", "leadId", "scope", "source",
    "reason", "sourceReference"])) return null;
  const tenantId = optionalUuid(body.tenantId); const campaignId = uuid(body.campaignId);
  const leadId = uuid(body.leadId); const reason = text(body.reason, 500);
  const sourceReference = text(body.sourceReference, 200);
  if (tenantId === null || !campaignId || !leadId || body.scope !== "tenant" ||
    !publicSources.includes(body.source as typeof publicSources[number]) ||
    !reason || !sourceReference) return null;
  return { ...(tenantId ? { tenantId } : {}), campaignId, leadId, scope: "tenant",
    source: body.source as Exclude<EnterpriseMarketingSuppressionSource,
      "global_registry">, reason, sourceReference };
}
function routeParams(value: { campaignId: string; leadId: string }) {
  const campaignId = uuid(value.campaignId); const leadId = uuid(value.leadId);
  return campaignId && leadId ? { campaignId, leadId } : null;
}
function object(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
  ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function optionalUuid(value: unknown) { return value === undefined ? undefined : uuid(value); }
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ? value : null; }
function text(value: unknown, maximum: number) { return typeof value === "string" &&
  value === value.trim() && Buffer.byteLength(value) >= 1 &&
  Buffer.byteLength(value) <= maximum ? value : null; }
function idempotencyKey(request: FastifyRequest) { const value =
  request.headers["idempotency-key"]; return typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) ? value : null; }
function invalid(reply: FastifyReply, code: string) { return sendError(reply, 400,
  code, "Invalid marketing suppression request"); }
function mismatch(reply: FastifyReply) { return sendError(reply, 409,
  "tenant_context_mismatch", "Tenant context mismatch"); }
function conflict(reply: FastifyReply) { return sendError(reply, 409,
  "idempotency_conflict", "Marketing suppression idempotency conflict"); }
function notFound(reply: FastifyReply) { return sendError(reply, 404,
  "marketing_suppression_scope_not_found", "Campaign or lead not found"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "PostgreSQL enterprise runtime required"); }
const publicSources = ["manual", "contact_request", "consent_withdrawal",
  "complaint"] as const;
