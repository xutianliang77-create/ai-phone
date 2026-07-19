import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EnterpriseMarketingSchedulerStatusDto } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from "./enterprise-auth.js";
import { marketingSchedulerClaimedTaskDto } from "./enterprise-marketing-scheduler.js";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import { decodeTenantRouteDocument, type TenantRouteService } from
  "./enterprise-tenant-route.js";

export function registerEnterpriseMarketingSchedulerRoutes(app: FastifyInstance,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime) {
  app.get<{ Params: { campaignId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/scheduler", async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      if (!campaignId) return invalid(reply);
      const access = await requireEnterpriseScope(request, reply, runtime, "campaign:read",
        { action: "marketing_scheduler.read", resourceType: "marketing_scheduler",
          resourceId: campaignId });
      if (!access || !requireTenantRouteDocument(request, reply, routeService,
        access.tenant)) return;
      if (!runtime.getMarketingSchedulerStatus) return postgresRequired(reply);
      const result = await runtime.getMarketingSchedulerStatus({ campaignId,
        context: createEnterpriseTenantContext({ tenantId: access.tenant.id,
          actorUserId: access.account.id, actorRole: access.member.role,
          traceId: enterpriseRequestTraceId(request) }) });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      return reply.send({ scheduler: statusDto(result) });
    },
  );

  app.post<{ Body: unknown }>("/internal/enterprise/marketing/scheduler/claim",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      const body = claimBody(request.body);
      if (!body) return invalid(reply);
      const document = decodeTenantRouteDocument(body.routeDocument);
      if (routeService.verify(document, body).status !== "verified") {
        return routeRejected(reply);
      }
      if (!runtime.claimMarketingSchedulerTasks) return postgresRequired(reply);
      const result = await runtime.claimMarketingSchedulerTasks({ ...body,
        traceId: enterpriseRequestTraceId(request), now: new Date(),
        leaseSeconds: leaseSeconds(), holdSeconds: 60 });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "route_mismatch") return routeRejected(reply);
      if (result.status === "entitlement_unavailable" ||
        result.status === "entitlement_denied") return sendError(reply, 409,
          result.status, "Marketing scheduler entitlement rejected");
      if (result.status !== "claimed" && result.status !== "empty") {
        return postgresRequired(reply);
      }
      return reply.send({ status: result.status,
        tasks: result.tasks.map(marketingSchedulerClaimedTaskDto),
        capacitySkipped: result.capacitySkipped,
        ...(result.budgetBlocked ? { budgetBlocked: result.budgetBlocked } : {}) });
    });
}

function statusDto(result: Extract<Awaited<ReturnType<NonNullable<
  EnterpriseRepositoryRuntime["getMarketingSchedulerStatus"]>>>, { status: "ready" }>):
  EnterpriseMarketingSchedulerStatusDto {
  const { campaign, scheduler, tenantConcurrencyLimit, budgetStatus } = result;
  const terminal = scheduler.counts.completed + scheduler.counts.failed +
    scheduler.counts.cancelled;
  const now = new Date().toISOString();
  const state = scheduler.counts.total === 0 ? "not_materialized" :
    terminal === scheduler.counts.total ? "complete" :
    budgetStatus !== "ready" ? "budget_blocked" :
    tenantConcurrencyLimit !== undefined && scheduler.tenantActiveClaims >= tenantConcurrencyLimit
      ? "capacity_blocked" : ["scheduled", "running"].includes(campaign.status) &&
        scheduler.nextDueAt !== undefined && scheduler.nextDueAt <= now
        ? "runnable" : scheduler.activeClaims > 0 ? "active" : "waiting";
  return { campaignId: campaign.id, campaignStatus: campaign.status, state,
    tasks: scheduler.counts, ...(scheduler.nextDueAt
      ? { nextDueAt: scheduler.nextDueAt } : {}), activeClaims: scheduler.activeClaims,
    campaignConcurrencyLimit: campaign.concurrencyLimit,
    tenantActiveClaims: scheduler.tenantActiveClaims,
    ...(tenantConcurrencyLimit ? { tenantConcurrencyLimit } : {}), budgetStatus };
}
function claimBody(value: unknown) {
  const body = object(value); const keys = ["tenantId", "homeRegion", "cellId",
    "routeEpoch", "routeDocument", "schedulerId", "batchSize"];
  if (!body || Object.keys(body).sort().join(",") !== keys.sort().join(",")) return null;
  const tenantId = uuid(body.tenantId); const homeRegion = code(body.homeRegion, 32);
  const cellId = code(body.cellId, 128); const schedulerId = code(body.schedulerId, 128);
  const routeEpoch = integer(body.routeEpoch, 1, Number.MAX_SAFE_INTEGER);
  const batchSize = integer(body.batchSize, 1, 50);
  const routeDocument = typeof body.routeDocument === "string" &&
    body.routeDocument.length <= 4_096 ? body.routeDocument : null;
  return tenantId && homeRegion && cellId && schedulerId && routeEpoch && batchSize &&
    routeDocument ? { tenantId, homeRegion, cellId, routeEpoch, routeDocument,
      schedulerId, batchSize } : null;
}
function internalAuthorized(request: FastifyRequest) {
  const expected = Buffer.from(process.env.INTERNAL_API_SECRET?.trim() ?? "");
  const header = request.headers.authorization;
  const supplied = Buffer.from(header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length) : "");
  return expected.length >= 16 && expected.length === supplied.length &&
    timingSafeEqual(expected, supplied);
}
function leaseSeconds() { const value = Number(process.env.ENTERPRISE_MARKETING_SCHEDULER_LEASE_SECONDS ?? 60); return Number.isInteger(value) && value >= 15 && value <= 120 ? value : 60; }
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value as Record<string, unknown> : null; }
function uuid(value: unknown) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) ? value : null; }
function code(value: unknown, max: number) { return typeof value === "string" && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null; }
function integer(value: unknown, min: number, max: number) { return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : null; }
function unauthorized(reply: FastifyReply) { return sendError(reply, 401, "internal_error", "Unauthorized internal request"); }
function invalid(reply: FastifyReply) { return sendError(reply, 400, "invalid_marketing_scheduler_request", "Invalid marketing scheduler request"); }
function routeRejected(reply: FastifyReply) { return sendError(reply, 409, "marketing_scheduler_route_rejected", "Marketing scheduler route rejected"); }
function notFound(reply: FastifyReply) { return sendError(reply, 404, "campaign_not_found", "Campaign not found"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503, "enterprise_postgres_required", "Enterprise PostgreSQL runtime required"); }
