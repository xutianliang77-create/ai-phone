import type { FastifyInstance } from "fastify";
import {
  isEnterpriseUsageCategory,
  isEnterpriseUsageUnit,
  type EnterpriseUsageBudgetDto,
} from "@translation/contracts";
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
  EnterpriseUsageBudgetRecord,
} from "./enterprise-usage-budget.js";

export async function registerEnterpriseUsageBudgetRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get("/enterprise/v1/usage/budgets", async (request, reply) => {
    const access = await accessFor(request, reply, runtime, routeService, "billing:read");
    if (!access) return;
    if (!runtime.listUsageBudgets) return postgresRequired(reply);
    const result = await runtime.listUsageBudgets({
      context: tenantContext(access, request.id),
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    return reply.send({ budgets: result.budgets.map(toDto) });
  });

  app.put<{ Params: { category: string } }>(
    "/enterprise/v1/usage/budgets/:category",
    async (request, reply) => {
      const access = await accessFor(
        request,
        reply,
        runtime,
        routeService,
        "billing:write",
      );
      if (!access) return;
      if (!runtime.configureUsageBudget) return postgresRequired(reply);
      const body = parseBody(request.params.category, request.body);
      if (!body) return sendError(reply, 400, "invalid_usage_budget", "Invalid budget");
      if (body.tenantId !== undefined && body.tenantId !== access.tenant.id) {
        return sendError(reply, 409, "tenant_context_mismatch", "Tenant context mismatch");
      }
      const result = await runtime.configureUsageBudget({
        context: tenantContext(access, request.id),
        budget: body.budget,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "conflict") {
        return sendError(reply, 409, "usage_budget_version_conflict", "Budget version conflict");
      }
      if (result.status === "period_overlap") {
        return sendError(reply, 409, "usage_budget_period_overlap", "Budget period overlaps");
      }
      return reply.status(result.status === "created" ? 201 : 200).send({
        budget: toDto(result.budget),
      });
    },
  );
}

async function accessFor(
  request: Parameters<typeof requireEnterpriseScope>[0],
  reply: Parameters<typeof requireEnterpriseScope>[1],
  runtime: EnterpriseRepositoryRuntime,
  routeService: TenantRouteService,
  scope: "billing:read" | "billing:write",
) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope, {
    action: scope === "billing:write" ? "usage_budget.configure" : "usage_budget.list",
    resourceType: "usage_budget",
  });
  if (!access || !requireTenantRouteDocument(
    request,
    reply,
    routeService,
    access.tenant,
  )) return null;
  return access;
}

function tenantContext(
  access: NonNullable<Awaited<ReturnType<typeof requireEnterpriseScope>>>,
  traceId: unknown,
) {
  return createEnterpriseTenantContext({
    tenantId: access.tenant.id,
    actorUserId: access.account.id,
    actorRole: access.member.role,
    traceId: String(traceId),
  });
}

function parseBody(category: string, value: unknown) {
  if (!isEnterpriseUsageCategory(category) || !value || typeof value !== "object") {
    return null;
  }
  const body = value as Record<string, unknown>;
  if (!isEnterpriseUsageUnit(body.unit) || !safeInt(body.limitAmount, 0) ||
    !safeInt(body.alertThresholdPercent, 1, 100) ||
    !timestamp(body.periodStart) || !timestamp(body.periodEnd) ||
    Date.parse(body.periodEnd as string) <= Date.parse(body.periodStart as string) ||
    (body.expectedVersion !== undefined && !safeInt(body.expectedVersion, 1)) ||
    (body.tenantId !== undefined && typeof body.tenantId !== "string")) return null;
  return {
    tenantId: body.tenantId as string | undefined,
    budget: {
      category,
      unit: body.unit,
      limitAmount: body.limitAmount as number,
      alertThresholdPercent: body.alertThresholdPercent as number,
      periodStart: new Date(body.periodStart as string).toISOString(),
      periodEnd: new Date(body.periodEnd as string).toISOString(),
      ...(body.expectedVersion === undefined
        ? {}
        : { expectedVersion: body.expectedVersion as number }),
    },
  };
}

function toDto(record: EnterpriseUsageBudgetRecord): EnterpriseUsageBudgetDto {
  return record;
}
function safeInt(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}
function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function postgresRequired(reply: Parameters<typeof sendError>[0]) {
  return sendError(
    reply,
    503,
    "enterprise_postgres_required",
    "PostgreSQL enterprise runtime required",
  );
}
