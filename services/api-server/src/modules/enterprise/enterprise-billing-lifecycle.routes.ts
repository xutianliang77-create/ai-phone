import type { FastifyInstance, FastifyReply } from "fastify";
import type { EnterpriseBillingLifecycleStatusResponse } from
  "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import { verifyEnterpriseBillingLifecycleRequest } from
  "./enterprise-billing-lifecycle-auth.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

interface TenantParams { tenantId: string }

export function registerEnterpriseBillingLifecycleRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.post("/internal/enterprise/billing/subscription-events", async (
    request,
    reply,
  ) => {
    const verified = verifyEnterpriseBillingLifecycleRequest({
      body: request.body,
      timestamp: request.headers["x-enterprise-billing-timestamp"],
      signature: request.headers["x-enterprise-billing-signature"],
    });
    if (verified.status === "not_ready") {
      return sendError(reply, 503, "billing_lifecycle_not_ready",
        verified.readiness.issues.join(","));
    }
    if (verified.status !== "verified") {
      return sendError(reply, 401, verified.reasonCode,
        "Billing lifecycle signature is invalid");
    }
    if (runtime.driver !== "postgres" || !runtime.ingestBillingLifecycleEvent) {
      return postgresRequired(reply);
    }
    const { tenantId, ...event } = verified.body;
    const result = await runtime.ingestBillingLifecycleEvent({
      context: createEnterpriseTenantContext({
        tenantId,
        actorUserId: "system:enterprise-billing-lifecycle",
        traceId: enterpriseRequestTraceId(request.id),
      }),
      event,
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    if (result.status === "idempotency_conflict") {
      return sendError(reply, 409, result.status, "Billing event conflict");
    }
    if (result.status === "account_not_found" ||
      result.status === "subscription_not_found") {
      return sendError(reply, 404, result.status, "Billing target not found");
    }
    return reply.status(result.status === "queued" ? 202 : 200).send({
      status: result.status,
      command: result.command,
    });
  });

  app.get<{ Params: TenantParams }>(
    "/saas/v1/tenants/:tenantId/subscription/lifecycle",
    async (request, reply) => {
      const access = await requireEnterpriseScope(
        request, reply, runtime, "billing:read",
        { action: "subscription.lifecycle.read", resourceType: "subscription" },
      );
      if (!access || !requireTenantRouteDocument(
        request, reply, routeService, access.tenant,
      )) return;
      if (request.params.tenantId !== access.tenant.id) {
        return sendError(reply, 409, "tenant_context_mismatch",
          "Tenant context mismatch");
      }
      if (!runtime.getBillingLifecycleStatus) return postgresRequired(reply);
      const result = await runtime.getBillingLifecycleStatus({
        context: createEnterpriseTenantContext({
          tenantId: access.tenant.id,
          actorUserId: access.account.id,
          actorRole: access.member.role,
          traceId: enterpriseRequestTraceId(request.id),
        }),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") {
        return sendError(reply, 404, "billing_lifecycle_not_found",
          "Billing lifecycle not found");
      }
      return reply.send(result.lifecycle satisfies
        EnterpriseBillingLifecycleStatusResponse);
    },
  );
}

function postgresRequired(reply: FastifyReply) {
  return sendError(reply, 503, "enterprise_postgres_required",
    "PostgreSQL required");
}
