import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import { validateEnterpriseKnowledgeSearch } from "./enterprise-knowledge.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseSupportRagRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.post<{ Params: { sessionId: string } }>(
    "/enterprise/v1/support/sessions/:sessionId/rag",
    async (request, reply) => {
      const access = await requireEnterpriseScope(
        request, reply, runtime, "support:read",
        { action: "support.rag.search", resourceType: "support_session" },
      );
      if (!access || !requireTenantRouteDocument(
        request, reply, routeService, access.tenant,
      )) return;
      const sessionId = uuid(request.params.sessionId);
      const search = ragRequest(request.body);
      if (!sessionId || !search) return invalid(reply);
      if (!runtime.resolveSupportKnowledge) return postgresRequired(reply);
      const result = await runtime.resolveSupportKnowledge({
        context: createEnterpriseTenantContext({
          tenantId: access.tenant.id,
          actorUserId: access.account.id,
          actorRole: access.member.role,
          traceId: enterpriseRequestTraceId(request),
        }),
        sessionId,
        search: { ...search, now: new Date().toISOString() },
      });
      if (result.status === "ready") {
        return reply.send({ resolution: result.resolution });
      }
      if (result.status === "not_found") return sendError(
        reply, 404, "support_session_not_found", "Support session not found",
      );
      if (result.status === "not_active") return sendError(
        reply, 409, "support_session_not_active", "Support session is not active",
      );
      return postgresRequired(reply);
    },
  );
}

function ragRequest(value: unknown) {
  const body = object(value);
  if (!body || !exactOptional(
    body, ["query", "locale", "countryCode", "productCode"], ["limit"],
  ) || typeof body.query !== "string" || typeof body.locale !== "string" ||
    typeof body.countryCode !== "string" || typeof body.productCode !== "string" ||
    (body.limit !== undefined && typeof body.limit !== "number")) return null;
  try {
    const search = validateEnterpriseKnowledgeSearch({
      query: body.query,
      locale: body.locale,
      countryCode: body.countryCode,
      productCode: body.productCode,
      limit: body.limit === undefined ? 6 : body.limit,
      now: new Date().toISOString(),
    });
    return {
      query: search.query,
      locale: search.locale,
      countryCode: search.countryCode,
      productCode: search.productCode,
      limit: search.limit,
    };
  } catch { return null; }
}

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function exactOptional(
  value: Record<string, unknown>, required: string[], optional: string[],
) {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}
function uuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value : null;
}
function invalid(reply: FastifyReply) {
  return sendError(reply, 400, "invalid_support_rag_request", "Invalid support RAG request");
}
function postgresRequired(reply: FastifyReply) {
  return sendError(reply, 503, "enterprise_postgres_required",
    "Enterprise PostgreSQL runtime required");
}
