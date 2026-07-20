import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";

export function registerEnterpriseMarketingAnalyticsRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get<{ Params: { campaignId: string } }>(
    "/enterprise/v1/campaigns/:campaignId/analytics",
    async (request, reply) => {
      const campaignId = uuid(request.params.campaignId);
      if (!campaignId) return invalid(reply);
      const access = await authorized(request, reply, routeService, runtime, campaignId);
      if (!access) return;
      if (!runtime.getMarketingAnalytics) return postgresRequired(reply);
      const result = await runtime.getMarketingAnalytics({
        context: createEnterpriseTenantContext({
          tenantId: access.tenant.id,
          actorUserId: access.account.id,
          actorRole: access.member.role,
          traceId: enterpriseRequestTraceId(request),
        }),
        campaignId,
        now: new Date(),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      return reply.send(result.analytics);
    },
  );
}

async function authorized(request: FastifyRequest, reply: FastifyReply,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime,
  campaignId: string) {
  const access = await requireEnterpriseScope(request, reply, runtime,
    "campaign:read", { action: "marketing_analytics.read",
      resourceType: "marketing_analytics", resourceId: campaignId });
  return access && requireTenantRouteDocument(request, reply, routeService,
    access.tenant) ? access : null;
}

function uuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value) ? value : null;
}
function invalid(reply: FastifyReply) { return sendError(reply, 400,
  "invalid_marketing_analytics_request", "Invalid marketing analytics request"); }
function notFound(reply: FastifyReply) { return sendError(reply, 404,
  "marketing_analytics_not_found", "Marketing analytics not found"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "Enterprise PostgreSQL runtime required"); }
