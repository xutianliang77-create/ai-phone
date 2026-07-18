import type { FastifyInstance } from "fastify";
import type { EnterpriseUsagePeriodAggregateDto } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireEnterpriseScope } from "./enterprise-auth.js";
import type {
  EnterpriseRepositoryRuntime,
} from "./enterprise-repository-runtime.js";
import {
  requireTenantRouteDocument,
} from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type {
  EnterpriseUsagePeriodAggregateRecord,
} from "./enterprise-usage-accounting.js";

export async function registerEnterpriseUsageAccountingRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get("/enterprise/v1/usage/aggregates", async (request, reply) => {
    const access = await requireEnterpriseScope(
      request,
      reply,
      runtime,
      "usage:read",
      { action: "usage_aggregate.list", resourceType: "usage_aggregate" },
    );
    if (!access || !requireTenantRouteDocument(
      request,
      reply,
      routeService,
      access.tenant,
    )) return;
    if (!runtime.listUsagePeriodAggregates) return postgresRequired(reply);
    const result = await runtime.listUsagePeriodAggregates({
      context: createEnterpriseTenantContext({
        tenantId: access.tenant.id,
        actorUserId: access.account.id,
        actorRole: access.member.role,
        traceId: String(request.id),
      }),
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    return reply.send({ aggregates: result.aggregates.map(toDto) });
  });
}

function toDto(
  record: EnterpriseUsagePeriodAggregateRecord,
): EnterpriseUsagePeriodAggregateDto {
  return record;
}

function postgresRequired(reply: Parameters<typeof sendError>[0]) {
  return sendError(
    reply,
    503,
    "enterprise_postgres_required",
    "PostgreSQL enterprise runtime required",
  );
}
