import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  enterpriseRequestTraceId,
  requireEnterpriseScope,
} from "./enterprise-auth.js";
import type {
  EnterpriseRepositoryRuntime,
} from "./enterprise-repository-runtime.js";
import {
  createEnterpriseTenantContext,
} from "./enterprise-tenant-context.js";

export async function registerEnterpriseObservabilityRoutes(
  app: FastifyInstance,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get<{ Params: { sessionId: string } }>(
    "/enterprise/v1/observability/sessions/:sessionId/report",
    async (request, reply) => {
      const access = await requireEnterpriseScope(
        request,
        reply,
        runtime,
        "audit:read",
        {
          action: "observability.session_report.read",
          resourceType: "communication_session",
          resourceId: boundedSessionId(request.params.sessionId) ?? undefined,
        },
      );
      if (!access) return;
      const sessionId = boundedSessionId(request.params.sessionId);
      if (!sessionId) {
        return sendError(
          reply,
          400,
          "invalid_observability_session_id",
          "Invalid session ID",
        );
      }
      if (!runtime.getSessionTraceReport) return postgresRequired(reply);
      const result = await runtime.getSessionTraceReport({
        context: createEnterpriseTenantContext({
          tenantId: access.tenant.id,
          actorUserId: access.account.id,
          actorRole: access.member.role,
          traceId: enterpriseRequestTraceId(request),
        }),
        sessionId,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") {
        return sendError(
          reply,
          404,
          "enterprise_session_report_not_found",
          "Session report not found",
        );
      }
      return reply.send(result.report);
    },
  );
}

function boundedSessionId(value: string) {
  const parsed = value.trim();
  return parsed && Buffer.byteLength(parsed) <= 200 ? parsed : null;
}

function postgresRequired(reply: Parameters<typeof sendError>[0]) {
  return sendError(
    reply,
    503,
    "enterprise_postgres_required",
    "PostgreSQL enterprise runtime required",
  );
}
