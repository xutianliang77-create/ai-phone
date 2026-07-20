import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CreateEnterpriseMarketingCrmSyncRequest } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from "./enterprise-auth.js";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import type { EnterpriseMarketingCrmSyncRecord } from "./enterprise-marketing-crm.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseMarketingCrmRoutes(app: FastifyInstance,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime) {
  app.get<{ Params: { campaignId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/crm-syncs", async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      if (!campaignId) return invalid(reply);
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:read", "marketing.crm_sync.list", campaignId);
      if (!access) return;
      if (!runtime.listMarketingCrmSyncs) return postgresRequired(reply);
      const result = await runtime.listMarketingCrmSyncs({
        context: context(request, access), campaignId, now: new Date() });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      return reply.send(result.result);
    });
  app.post<{ Params: { campaignId: string; outcomeId: string }; Body: unknown }>(
    "/enterprise/v1/campaigns/:campaignId/outcomes/:outcomeId/crm-sync",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      const outcomeId = uuid(request.params.outcomeId);
      const body = parseBody(request.body); const idempotencyKey = commandKey(request);
      if (!campaignId || !outcomeId || !body || !idempotencyKey) return invalid(reply);
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:write", "marketing.crm_sync.request", outcomeId);
      if (!access) return;
      if (!runtime.requestMarketingCrmSync) return postgresRequired(reply);
      const result = await runtime.requestMarketingCrmSync({
        context: context(request, access), campaignId, outcomeId,
        expectedOutcomeVersion: body.expectedOutcomeVersion,
        idempotencyKey, now: new Date() });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "not_configured") return sendError(reply, 503,
        "marketing_crm_not_ready", `CRM sync not ready: ${result.reasonCode}`);
      if (result.status === "conflict" || result.status === "already_requested" ||
        result.status === "idempotency_conflict") return sendError(reply, 409,
          result.status === "idempotency_conflict" ? "idempotency_conflict" :
            `marketing_crm_${result.status}`, "Marketing CRM sync conflict");
      if (result.status !== "created" && result.status !== "replayed") {
        return sendError(reply, 409, "marketing_crm_sync_conflict",
          "Marketing CRM sync conflict");
      }
      return reply.code(result.status === "created" ? 202 : 200).send({
        status: result.status, sync: dto(result.sync) });
    });
}

async function authorized(request: FastifyRequest, reply: FastifyReply,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime,
  scope: "campaign:read" | "campaign:write", action: string, resourceId: string) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope,
    { action, resourceType: "marketing_crm_sync", resourceId });
  return access && requireTenantRouteDocument(request, reply, routeService, access.tenant)
    ? access : null;
}
function context(request: FastifyRequest, access: NonNullable<Awaited<ReturnType<
  typeof requireEnterpriseScope>>>) { return createEnterpriseTenantContext({
  tenantId: access.tenant.id, actorUserId: access.account.id,
  actorRole: access.member.role, traceId: enterpriseRequestTraceId(request) }); }
function parseBody(value: unknown): CreateEnterpriseMarketingCrmSyncRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 1 && Number.isSafeInteger(
    item.expectedOutcomeVersion) && Number(item.expectedOutcomeVersion) > 0
    ? { expectedOutcomeVersion: Number(item.expectedOutcomeVersion) } : null;
}
function dto(sync: EnterpriseMarketingCrmSyncRecord) {
  return { id: sync.id, campaignId: sync.campaignId, outcomeId: sync.outcomeId,
    provider: sync.provider, status: sync.status,
    externalRecordKey: sync.externalRecordKey, objectApiName: sync.objectApiName,
    ...(sync.providerRecordId ? { providerRecordId: sync.providerRecordId } : {}),
    ...(sync.providerRecordUrl ? { providerRecordUrl: sync.providerRecordUrl } : {}),
    attempts: sync.attempts,
    ...(sync.lastErrorCode ? { lastErrorCode: sync.lastErrorCode } : {}),
    createdAt: sync.createdAt, updatedAt: sync.updatedAt,
    ...(sync.syncedAt ? { syncedAt: sync.syncedAt } : {}), version: sync.version };
}
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value) ? value : null; }
function commandKey(request: FastifyRequest) { const value =
  request.headers["idempotency-key"]; return typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) ? value : null; }
function invalid(reply: FastifyReply) { return sendError(reply, 400,
  "invalid_marketing_crm_sync_request", "Invalid marketing CRM sync request"); }
function notFound(reply: FastifyReply) { return sendError(reply, 404,
  "marketing_crm_resource_not_found", "Marketing CRM resource not found"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "PostgreSQL enterprise runtime required"); }
