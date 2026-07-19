import type { FastifyInstance, FastifyReply } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import type { EnterpriseSupportFollowupRecord } from "./enterprise-support.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseSupportFollowupRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.post<{ Params: { sessionId: string }; Body: unknown }>(
    "/enterprise/v1/support/sessions/:sessionId/followups/tickets",
    async (request, reply) => {
      const access = await authorized(request, reply, runtime, routeService,
        "support.followup.ticket.create");
      if (!access) return;
      const body = ticketBody(request.body);
      if (!uuid(request.params.sessionId) || !body) return invalid(reply);
      if (!runtime.createSupportFollowup) return postgresRequired(reply);
      const result = await runtime.createSupportFollowup({
        context: createEnterpriseTenantContext({ tenantId: access.tenant.id,
          actorUserId: access.account.id, actorRole: access.member.role,
          traceId: enterpriseRequestTraceId(request) }),
        sessionId: request.params.sessionId,
        expectedSessionVersion: body.expectedSessionVersion,
        expectedClaimVersion: body.expectedClaimVersion,
        idempotencyKey: body.idempotencyKey,
        now: new Date().toISOString(),
        action: { kind: "ticket", subject: body.subject,
          description: body.description },
      });
      return result.status === "processing" || result.status === "replayed"
        ? reply.code(202).send({ status: result.status,
            followup: publicFollowup(result.followup) })
        : failure(reply, result);
    },
  );

  app.post<{ Params: { sessionId: string }; Body: unknown }>(
    "/enterprise/v1/support/sessions/:sessionId/followups/callbacks",
    async (request, reply) => {
      const access = await authorized(request, reply, runtime, routeService,
        "support.followup.callback.schedule");
      if (!access) return;
      const body = callbackBody(request.body);
      if (!uuid(request.params.sessionId) || !body) return invalid(reply);
      if (!runtime.createSupportFollowup) return postgresRequired(reply);
      const result = await runtime.createSupportFollowup({
        context: createEnterpriseTenantContext({ tenantId: access.tenant.id,
          actorUserId: access.account.id, actorRole: access.member.role,
          traceId: enterpriseRequestTraceId(request) }),
        sessionId: request.params.sessionId,
        expectedSessionVersion: body.expectedSessionVersion,
        expectedClaimVersion: body.expectedClaimVersion,
        idempotencyKey: body.idempotencyKey,
        now: new Date().toISOString(),
        action: { kind: "callback", scheduledAt: body.scheduledAt,
          reason: body.reason },
      });
      return result.status === "processing" || result.status === "replayed"
        ? reply.code(202).send({ status: result.status,
            followup: publicFollowup(result.followup) })
        : failure(reply, result);
    },
  );
}

async function authorized(
  request: Parameters<typeof requireEnterpriseScope>[0],
  reply: FastifyReply,
  runtime: EnterpriseRepositoryRuntime,
  routeService: TenantRouteService,
  action: string,
) {
  const access = await requireEnterpriseScope(request, reply, runtime,
    "support:takeover", { action, resourceType: "support_session" });
  return access && requireTenantRouteDocument(request, reply, routeService, access.tenant)
    ? access : null;
}
function ticketBody(value: unknown) {
  const body = object(value);
  if (!body || !exact(body, ["subject", "description", "idempotencyKey",
    "expectedSessionVersion", "expectedClaimVersion"])) return null;
  const subject = text(body.subject, 160);
  const description = text(body.description, 2_000);
  const common = commonBody(body);
  return subject && description && common ? { subject, description, ...common } : null;
}
function callbackBody(value: unknown) {
  const body = object(value);
  if (!body || !exact(body, ["scheduledAt", "reason", "idempotencyKey",
    "expectedSessionVersion", "expectedClaimVersion"])) return null;
  const scheduledAt = iso(body.scheduledAt);
  const reason = text(body.reason, 500);
  const common = commonBody(body);
  return scheduledAt && reason && common ? { scheduledAt, reason, ...common } : null;
}
function commonBody(body: Record<string, unknown>) {
  return positive(body.expectedSessionVersion) && positive(body.expectedClaimVersion) &&
    key(body.idempotencyKey) ? {
      expectedSessionVersion: body.expectedSessionVersion as number,
      expectedClaimVersion: body.expectedClaimVersion as number,
      idempotencyKey: body.idempotencyKey as string,
    } : null;
}
function publicFollowup(item: EnterpriseSupportFollowupRecord) {
  return { id: item.id, kind: item.kind, status: item.status,
    caseId: item.caseId, callbackId: item.callbackId,
    providerSimulated: item.providerSimulated, attempts: item.attempts,
    failureCode: item.failureCode, createdAt: item.createdAt,
    updatedAt: item.updatedAt, completedAt: item.completedAt,
    version: item.version };
}
function failure(reply: FastifyReply, result: { status: string; reasonCode?: string }) {
  if (result.status === "not_configured") return sendError(reply, 503,
    result.reasonCode || result.status, "Support followup Provider is not configured");
  if (result.status === "not_found") return sendError(reply, 404, result.status,
    "Support session not found");
  if (result.status === "forbidden") return sendError(reply, 403, result.status,
    "Support followup access forbidden");
  if (result.status === "invalid_arguments") return invalid(reply);
  if (result.status === "storage_required") return postgresRequired(reply);
  return sendError(reply, 409, result.status, "Support followup is not available");
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
    ? value as Record<string, unknown> : null;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function text(value: unknown, max: number) { return typeof value === "string" &&
  value.trim() === value && value.length > 0 && Buffer.byteLength(value) <= max
  ? value : null; }
function iso(value: unknown) { return typeof value === "string" &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
  ? value : null; }
function positive(value: unknown) { return Number.isSafeInteger(value) && Number(value) >= 1; }
function key(value: unknown) { return typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value); }
function uuid(value: unknown): value is string { return typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function invalid(reply: FastifyReply) { return sendError(reply, 400,
  "invalid_support_followup_request", "Invalid Support followup request"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "Enterprise PostgreSQL runtime required"); }
