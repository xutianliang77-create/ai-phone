import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { UpsertEnterpriseMarketingHandoffPolicyRequest } from
  "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from "./enterprise-auth.js";
import { enterpriseMarketingHandoffHash } from "./enterprise-marketing-handoff.js";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { decodeTenantRouteDocument } from "./enterprise-tenant-route.js";

export function registerEnterpriseMarketingHandoffRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get<{ Params: { campaignId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/handoff",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      if (!campaignId) return invalid(reply);
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:read", "marketing.handoff.read", campaignId);
      if (!access) return;
      if (!runtime.getMarketingHandoffStatus) return postgresRequired(reply);
      const result = await runtime.getMarketingHandoffStatus({ campaignId,
        context: context(request, access) });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      return reply.send({ campaignId: result.campaignId,
        ...(result.policy ? { policy: result.policy } : {}),
        readiness: result.readiness, provider: result.provider });
    },
  );

  app.put<{ Params: { campaignId: string }; Body: unknown }>(
    "/enterprise/v1/campaigns/:campaignId/handoff",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      const body = policyBody(request.body); const idempotencyKey = commandKey(request);
      if (!campaignId || !body || !idempotencyKey) return invalid(reply);
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:write", "marketing.handoff_policy.upsert", campaignId);
      if (!access) return;
      if (body.tenantId && body.tenantId !== access.tenant.id) return mismatch(reply);
      if (!runtime.upsertMarketingHandoffPolicy) return postgresRequired(reply);
      const common = { actorUserId: access.account.id, campaignId,
        supportQueueId: body.supportQueueId, supportChannelId: body.supportChannelId,
        timeoutSeconds: body.timeoutSeconds, timeoutAction: body.timeoutAction,
        ...(body.callbackDelaySeconds !== undefined
          ? { callbackDelaySeconds: body.callbackDelaySeconds } : {}),
        ...(body.expectedVersion !== undefined
          ? { expectedVersion: body.expectedVersion } : {}) };
      const result = await runtime.upsertMarketingHandoffPolicy({
        context: context(request, access), campaignId, policyId: randomUUID(),
        supportQueueId: body.supportQueueId, supportChannelId: body.supportChannelId,
        timeoutSeconds: body.timeoutSeconds, timeoutAction: body.timeoutAction,
        ...(body.callbackDelaySeconds !== undefined
          ? { callbackDelaySeconds: body.callbackDelaySeconds } : {}),
        ...(body.expectedVersion !== undefined
          ? { expectedVersion: body.expectedVersion } : {}),
        idempotencyKey, requestHash: enterpriseMarketingHandoffHash(common),
        occurredAt: new Date().toISOString(),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      if (["not_editable", "resource_not_ready", "version_conflict",
        "idempotency_conflict"].includes(result.status)) {
        return conflict(reply, `marketing_handoff_${result.status}`);
      }
      if (!("policy" in result)) return conflict(reply, "marketing_handoff_conflict");
      return reply.code(result.status === "created" ? 201 : 200).send({
        status: result.status === "created" ? "created" : "updated",
        policy: result.policy,
        ...(result.status === "replayed" ? { replayed: true } : {}),
      });
    },
  );

  app.post<{ Body: unknown }>(
    "/internal/enterprise/marketing/handoffs/timeouts",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      const body = timeoutBody(request.body);
      if (!body) return invalid(reply);
      const document = decodeTenantRouteDocument(body.routeDocument);
      if (routeService.verify(document, body).status !== "verified") {
        return conflict(reply, "marketing_handoff_route_rejected");
      }
      if (!runtime.processMarketingHandoffTimeouts) return postgresRequired(reply);
      const result = await runtime.processMarketingHandoffTimeouts({
        tenantId: body.tenantId, homeRegion: body.homeRegion, cellId: body.cellId,
        routeEpoch: body.routeEpoch, workerId: body.workerId,
        traceId: enterpriseRequestTraceId(request),
        now: new Date().toISOString(), batchSize: body.batchSize,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "route_mismatch") {
        return conflict(reply, "marketing_handoff_route_rejected");
      }
      return reply.send(result);
    },
  );
}

async function authorized(request: FastifyRequest, reply: FastifyReply,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime,
  scope: "campaign:read" | "campaign:write", action: string, resourceId: string) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope,
    { action, resourceType: "marketing_handoff", resourceId });
  return access && requireTenantRouteDocument(request, reply, routeService, access.tenant)
    ? access : null;
}
function context(request: FastifyRequest, access: NonNullable<Awaited<ReturnType<
  typeof requireEnterpriseScope>>>) { return createEnterpriseTenantContext({
  tenantId: access.tenant.id, actorUserId: access.account.id,
  actorRole: access.member.role, traceId: enterpriseRequestTraceId(request) }); }
function policyBody(value: unknown): UpsertEnterpriseMarketingHandoffPolicyRequest | null {
  const body = object(value); if (!body || !exact(body, ["tenantId", "supportQueueId",
    "supportChannelId", "timeoutSeconds", "timeoutAction", "callbackDelaySeconds",
    "expectedVersion"])) return null;
  const tenantId = optionalUuid(body.tenantId); const supportQueueId = uuid(body.supportQueueId);
  const supportChannelId = uuid(body.supportChannelId);
  const timeoutSeconds = integer(body.timeoutSeconds, 10, 86_400);
  const timeoutAction = body.timeoutAction === "end_call" || body.timeoutAction === "callback"
    ? body.timeoutAction : null;
  const callbackDelaySeconds = body.callbackDelaySeconds === undefined ? undefined
    : integer(body.callbackDelaySeconds, 60, 604_800);
  const expectedVersion = body.expectedVersion === undefined ? undefined
    : integer(body.expectedVersion, 1, Number.MAX_SAFE_INTEGER);
  if (tenantId === null || !supportQueueId || !supportChannelId || !timeoutSeconds ||
    !timeoutAction || callbackDelaySeconds === null || expectedVersion === null ||
    timeoutAction === "callback" && callbackDelaySeconds === undefined ||
    timeoutAction === "end_call" && callbackDelaySeconds !== undefined) return null;
  return { ...(tenantId ? { tenantId } : {}), supportQueueId, supportChannelId,
    timeoutSeconds, timeoutAction, ...(callbackDelaySeconds !== undefined
      ? { callbackDelaySeconds } : {}), ...(expectedVersion !== undefined
      ? { expectedVersion } : {}) };
}
function object(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) ===
  Object.prototype ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key)); }
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value : null; }
function optionalUuid(value: unknown) { return value === undefined ? undefined : uuid(value); }
function integer(value: unknown, min: number, max: number) { return typeof value === "number" &&
  Number.isSafeInteger(value) && value >= min && value <= max ? value : null; }
function commandKey(request: FastifyRequest) { const value = request.headers["idempotency-key"];
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
    ? value : null; }
function timeoutBody(value: unknown) {
  const body = object(value); const keys = ["tenantId", "homeRegion", "cellId",
    "routeEpoch", "routeDocument", "workerId", "batchSize"];
  if (!body || Object.keys(body).sort().join(",") !== keys.sort().join(",")) return null;
  const tenantId = uuid(body.tenantId); const homeRegion = workerCode(body.homeRegion, 32);
  const cellId = workerCode(body.cellId, 128); const workerId = workerCode(body.workerId, 128);
  const routeEpoch = integer(body.routeEpoch, 1, Number.MAX_SAFE_INTEGER);
  const batchSize = integer(body.batchSize, 1, 100);
  const routeDocument = typeof body.routeDocument === "string" &&
    body.routeDocument.length <= 4_096 ? body.routeDocument : null;
  return tenantId && homeRegion && cellId && workerId && routeEpoch && batchSize &&
    routeDocument ? { tenantId, homeRegion, cellId, workerId, routeEpoch,
      batchSize, routeDocument } : null;
}
function internalAuthorized(request: FastifyRequest) {
  const expected = Buffer.from(process.env.INTERNAL_API_SECRET?.trim() ?? "");
  const authorization = request.headers.authorization;
  const supplied = Buffer.from(authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length) : "");
  return expected.length >= 16 && expected.length === supplied.length &&
    timingSafeEqual(expected, supplied);
}
function workerCode(value: unknown, max: number) { return typeof value === "string" &&
  value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null; }
function invalid(reply: FastifyReply) { return sendError(reply, 400,
  "invalid_marketing_handoff_request", "Invalid marketing handoff request"); }
function conflict(reply: FastifyReply, code: string) { return sendError(reply, 409,
  code, "Marketing handoff conflict"); }
function mismatch(reply: FastifyReply) { return sendError(reply, 409,
  "tenant_context_mismatch", "Tenant context mismatch"); }
function notFound(reply: FastifyReply) { return sendError(reply, 404,
  "campaign_not_found", "Campaign not found"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "PostgreSQL enterprise runtime required"); }
function unauthorized(reply: FastifyReply) { return sendError(reply, 401,
  "internal_error", "Unauthorized internal request"); }
