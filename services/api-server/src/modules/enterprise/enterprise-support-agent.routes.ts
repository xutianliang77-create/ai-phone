import type { FastifyInstance, FastifyReply } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import type { EnterpriseSupportAgentDispatchService } from
  "./enterprise-support-agent-dispatch.js";
import type { EnterpriseSupportAgentProvider } from "./enterprise-support-agent.js";
import { registerEnterpriseSupportAgentWorkerRoutes } from
  "./enterprise-support-agent-worker.routes.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { recordEnterpriseReleaseOutcome, requireEnterpriseReleaseCapability } from
  "./enterprise-release-control.guard.js";

export function registerEnterpriseSupportAgentRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  provider: EnterpriseSupportAgentProvider,
  dispatchService: EnterpriseSupportAgentDispatchService,
) {
  registerEnterpriseSupportAgentWorkerRoutes(app, runtime, provider);
  app.post<{ Params: { sessionId: string } }>(
    "/enterprise/v1/support/sessions/:sessionId/agent",
    async (request, reply) => {
      const access = await requireEnterpriseScope(
        request, reply, runtime, "support:manage",
        { action: "support.agent.dispatch", resourceType: "support_session" },
      );
      if (!access || !requireTenantRouteDocument(
        request, reply, routeService, access.tenant,
      )) return;
      const sessionId = request.params.sessionId;
      const body = startRequest(request.body);
      if (!uuid(sessionId) || !body) return invalid(reply);
      if (!runtime.prepareSupportAgent) return postgresRequired(reply);
      const context = createEnterpriseTenantContext({ tenantId: access.tenant.id,
        actorUserId: access.account.id, actorRole: access.member.role,
        traceId: enterpriseRequestTraceId(request) });
      if (!await requireEnterpriseReleaseCapability(
        reply, runtime, context, "support.agent",
      )) return;
      const result = await runtime.prepareSupportAgent({
        context,
        sessionId, ...body, now: new Date().toISOString(),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status !== "ready") return notReady(reply, result.reasonCode);
      const dispatched = await dispatchService.ensure(result.dispatch);
      const recorded = await recordEnterpriseReleaseOutcome({ runtime, context,
        capability: "support.agent", operationId: result.dispatch.runId,
        outcome: dispatched.status === "ready" ? "success" : "failure",
        actorId: "system:support-agent-dispatch" });
      if (!recorded) return notReady(reply, "release_outcome_not_recorded");
      if (dispatched.status !== "ready") return notReady(reply, dispatched.reasonCode);
      return reply.send(result.dispatch);
    },
  );
}

function startRequest(value: unknown) {
  const body = record(value);
  if (!body || Object.keys(body).sort().join(",") !==
    ["countryCode", "locale", "productCode", "queueId"].sort().join(",") ||
    !uuid(body.queueId) || typeof body.locale !== "string" ||
    !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(body.locale) ||
    typeof body.countryCode !== "string" || !/^[A-Z]{2}$/.test(body.countryCode) ||
    typeof body.productCode !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(body.productCode)) return null;
  return { queueId: body.queueId, locale: body.locale,
    countryCode: body.countryCode, productCode: body.productCode };
}
function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}
function invalid(reply: FastifyReply) {
  return sendError(reply, 400, "invalid_support_agent_request",
    "Invalid Support Agent request");
}
function notReady(reply: FastifyReply, reasonCode: string) {
  return sendError(reply, 503, reasonCode, "Support Agent is not ready");
}
function postgresRequired(reply: FastifyReply) {
  return sendError(reply, 503, "enterprise_postgres_required",
    "Enterprise PostgreSQL runtime required");
}
