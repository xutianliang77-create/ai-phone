import type { FastifyInstance } from "fastify";
import type { EnterpriseDashboardBusinessSummaryResponse } from
  "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import { hasEnterpriseScope } from "./enterprise-rbac.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";

export function registerEnterpriseDashboardRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get("/enterprise/v1/dashboard/business-summary", async (request, reply) => {
    const access = await requireEnterpriseScope(request, reply, runtime, "tenant:read",
      { action: "dashboard.business_summary_read", resourceType: "tenant_dashboard" });
    if (!access || !requireTenantRouteDocument(
      request, reply, routeService, access.tenant,
    )) return;
    if (runtime.driver !== "postgres" ||
      !runtime.getEnterpriseDashboardBusinessSummary) return postgresRequired(reply);
    const context = createEnterpriseTenantContext({ tenantId: access.tenant.id,
      actorUserId: access.account.id, actorRole: access.member.role,
      traceId: enterpriseRequestTraceId(request) });
    const result = await runtime.getEnterpriseDashboardBusinessSummary({ context,
      includeMarketing: hasEnterpriseScope(access.member.role, "campaign:read"),
      includeSupport: hasEnterpriseScope(access.member.role, "support:read"),
      includeMeetings: hasEnterpriseScope(access.member.role, "meeting:read") });
    if (result.status === "storage_required") return postgresRequired(reply);
    const response: EnterpriseDashboardBusinessSummaryResponse = result.summary;
    return reply.send(response);
  });
}

function postgresRequired(reply: Parameters<typeof sendError>[0]) {
  return sendError(reply, 503, "enterprise_postgres_required",
    "Enterprise PostgreSQL runtime required");
}
