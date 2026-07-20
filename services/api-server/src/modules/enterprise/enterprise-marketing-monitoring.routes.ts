import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  enterpriseRequestTraceId,
  requireEnterpriseScope,
} from "./enterprise-auth.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from
  "./enterprise-tenant-context.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { requireTenantRouteDocument } from
  "./enterprise-tenant-route.routes.js";

export function registerEnterpriseMarketingMonitoringRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get<{ Params: { campaignId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/monitoring",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      if (!campaignId) return invalid(reply);
      const access = await authorized(
        request,
        reply,
        routeService,
        runtime,
        "marketing_monitor.snapshot.read",
        campaignId,
      );
      if (!access) return;
      if (!runtime.getMarketingMonitoringSnapshot) return postgresRequired(reply);
      const result = await runtime.getMarketingMonitoringSnapshot({
        context: context(request, access),
        campaignId,
        now: new Date(),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      return reply.send(result.snapshot);
    },
  );

  app.get<{ Params: { campaignId: string; dispatchId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/monitoring/calls/:dispatchId",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      const dispatchId = uuid(request.params.dispatchId);
      if (!campaignId || !dispatchId) return invalid(reply);
      const access = await authorized(
        request,
        reply,
        routeService,
        runtime,
        "marketing_monitor.call.read",
        dispatchId,
      );
      if (!access) return;
      if (!runtime.getMarketingMonitoringCall) return postgresRequired(reply);
      const result = await runtime.getMarketingMonitoringCall({
        context: context(request, access),
        campaignId,
        dispatchId,
        now: new Date(),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      return reply.send(result.detail);
    },
  );
}

async function authorized(
  request: FastifyRequest,
  reply: FastifyReply,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  action: string,
  resourceId: string,
) {
  const access = await requireEnterpriseScope(
    request,
    reply,
    runtime,
    "campaign:read",
    { action, resourceType: "marketing_monitor", resourceId },
  );
  return access && requireTenantRouteDocument(
    request,
    reply,
    routeService,
    access.tenant,
  ) ? access : null;
}

function context(
  request: FastifyRequest,
  access: NonNullable<Awaited<ReturnType<typeof requireEnterpriseScope>>>,
) {
  return createEnterpriseTenantContext({
    tenantId: access.tenant.id,
    actorUserId: access.account.id,
    actorRole: access.member.role,
    traceId: enterpriseRequestTraceId(request),
  });
}

function uuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
    ? value
    : null;
}

function invalid(reply: FastifyReply) {
  return sendError(
    reply,
    400,
    "invalid_marketing_monitor_request",
    "Invalid marketing monitor request",
  );
}

function notFound(reply: FastifyReply) {
  return sendError(
    reply,
    404,
    "marketing_monitor_not_found",
    "Marketing monitor resource not found",
  );
}

function postgresRequired(reply: FastifyReply) {
  return sendError(
    reply,
    503,
    "enterprise_postgres_required",
    "Enterprise PostgreSQL runtime required",
  );
}
