import type { FastifyInstance } from "fastify";
import type {
  EnterpriseEntitlementsResponse,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireEnterpriseScope } from "./enterprise-auth.js";
import type {
  EnterpriseEntitlementState,
} from "./enterprise-billing-entitlement.js";
import type {
  EnterpriseRepositoryRuntime,
} from "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import {
  requireTenantRouteDocument,
} from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

interface TenantParams { tenantId: string }

export async function registerEnterpriseBillingEntitlementRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get<{ Params: TenantParams }>(
    "/saas/v1/tenants/:tenantId/entitlements",
    async (request, reply) => {
      const access = await authorized(
        request,
        reply,
        runtime,
        routeService,
        "billing:read",
      );
      if (!access) return;
      if (request.params.tenantId !== access.tenant.id) return mismatch(reply);
      if (!runtime.getBillingEntitlements) return postgresRequired(reply);
      const result = await runtime.getBillingEntitlements({
        context: contextFor(access, request.id),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") {
        return sendError(reply, 404, "entitlement_not_found", "Entitlement not found");
      }
      return reply.send(toResponse(result.state));
    },
  );

  app.post<{ Params: TenantParams }>(
    "/saas/v1/tenants/:tenantId/subscription/change",
    async (request, reply) => {
      const access = await authorized(
        request,
        reply,
        runtime,
        routeService,
        "billing:write",
      );
      if (!access) return;
      if (request.params.tenantId !== access.tenant.id) return mismatch(reply);
      if (!runtime.changeSubscription) return postgresRequired(reply);
      const parsed = parseChange(request.body);
      if (!parsed) {
        return sendError(reply, 400, "invalid_subscription_change", "Invalid change");
      }
      if (parsed.tenantId !== undefined && parsed.tenantId !== access.tenant.id) {
        return mismatch(reply);
      }
      const result = await runtime.changeSubscription({
        context: contextFor(access, request.id),
        change: parsed.change,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "plan_not_found" || result.status === "plan_retired") {
        return sendError(reply, 409, result.status, "Plan is unavailable");
      }
      if (result.status === "billing_account_inactive") {
        return sendError(reply, 402, result.status, "Billing account is inactive");
      }
      if (result.status === "seat_limit_exceeded") {
        return sendError(reply, 409, result.status, "Seat limit exceeded");
      }
      if (result.status === "idempotency_conflict") {
        return sendError(reply, 409, result.status, "Idempotency conflict");
      }
      return reply.status(result.status === "changed" ? 201 : 200).send(
        toResponse(result),
      );
    },
  );
}

async function authorized(
  request: Parameters<typeof requireEnterpriseScope>[0],
  reply: Parameters<typeof requireEnterpriseScope>[1],
  runtime: EnterpriseRepositoryRuntime,
  routeService: TenantRouteService,
  scope: "billing:read" | "billing:write",
) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope, {
    action: scope === "billing:write" ? "subscription.change" : "entitlement.read",
    resourceType: scope === "billing:write" ? "subscription" : "entitlement",
  });
  if (!access || !requireTenantRouteDocument(
    request,
    reply,
    routeService,
    access.tenant,
  )) return null;
  return access;
}

function parseChange(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!bounded(body.planCode, 80) || !bounded(body.planVersion, 128) ||
    !bounded(body.idempotencyKey, 200) || !safeInt(body.seats, 0) ||
    (body.billingCycle !== "monthly" && body.billingCycle !== "annual") ||
    (body.tenantId !== undefined && typeof body.tenantId !== "string")) return null;
  return {
    tenantId: body.tenantId as string | undefined,
    change: {
      planCode: String(body.planCode).trim(),
      planVersion: String(body.planVersion).trim(),
      seats: Number(body.seats),
      billingCycle: body.billingCycle as "monthly" | "annual",
      idempotencyKey: String(body.idempotencyKey).trim(),
    },
  };
}

function toResponse(state: EnterpriseEntitlementState): EnterpriseEntitlementsResponse {
  return {
    account: state.account,
    subscription: state.subscription,
    entitlement: state.entitlement,
  };
}
function contextFor(
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
function mismatch(reply: Parameters<typeof sendError>[0]) {
  return sendError(reply, 409, "tenant_context_mismatch", "Tenant context mismatch");
}
function postgresRequired(reply: Parameters<typeof sendError>[0]) {
  return sendError(reply, 503, "enterprise_postgres_required", "PostgreSQL required");
}
function bounded(value: unknown, max: number) {
  return typeof value === "string" && value.trim() && Buffer.byteLength(value) <= max;
}
function safeInt(value: unknown, minimum: number) {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}
