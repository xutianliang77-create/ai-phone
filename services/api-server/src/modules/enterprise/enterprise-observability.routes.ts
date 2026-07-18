import type { FastifyInstance } from "fastify";
import {
  enterpriseClientEventKinds,
  type EnterpriseClientEventRequest,
} from "@translation/contracts";
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
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";

export async function registerEnterpriseObservabilityRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
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

  app.post<{ Body: unknown }>(
    "/enterprise/v1/observability/client-events",
    async (request, reply) => {
      const access = await requireEnterpriseScope(
        request,
        reply,
        runtime,
        "tenant:read",
      );
      if (!access || !requireTenantRouteDocument(
        request,
        reply,
        routeService,
        access.tenant,
      )) return;
      const event = parseClientEvent(request.body);
      if (!event) {
        return sendError(
          reply,
          400,
          "invalid_enterprise_client_event",
          "Invalid enterprise client event",
        );
      }
      const traceId = enterpriseRequestTraceId(request);
      const attributes = {
        event: "enterprise.client_event",
        tenantId: access.tenant.id,
        homeRegion: access.tenant.homeRegion,
        cellId: access.tenant.cellId,
        routeEpoch: access.tenant.version,
        actorRole: access.member.role,
        traceId,
        ...event,
      };
      if (event.kind === "performance") {
        request.log.info(attributes, "Enterprise client performance event");
      } else {
        request.log.error(attributes, "Enterprise client error event");
      }
      return reply.code(202).send({ accepted: true, traceId });
    },
  );
}

function parseClientEvent(value: unknown): EnterpriseClientEventRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const allowed = new Set([
    "kind", "code", "routePath", "appVersion", "releaseCommit", "occurredAt",
    "fingerprint", "metricName", "value",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  if (!enterpriseClientEventKinds.includes(body.kind as never) ||
    !identifier(body.code, 64) || !routePath(body.routePath) ||
    !releaseLabel(body.appVersion) || !releaseCommit(body.releaseCommit) ||
    !timestamp(body.occurredAt)) return null;
  const kind = body.kind as EnterpriseClientEventRequest["kind"];
  if (kind === "performance") {
    if (!identifier(body.metricName, 64) || !metricValue(body.value) ||
      body.fingerprint !== undefined) return null;
  } else if (!fingerprint(body.fingerprint) || body.metricName !== undefined ||
    body.value !== undefined) return null;
  return body as unknown as EnterpriseClientEventRequest;
}

function identifier(value: unknown, max: number) {
  return typeof value === "string" && value.length <= max &&
    /^[a-z][a-z0-9._-]*$/.test(value);
}

function routePath(value: unknown) {
  return typeof value === "string" && value.length <= 240 &&
    value.startsWith("/") && !/[?#\r\n]/.test(value);
}

function releaseLabel(value: unknown) {
  return typeof value === "string" && value.length <= 80 &&
    /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value);
}

function releaseCommit(value: unknown) {
  return value === "unversioned" ||
    (typeof value === "string" && /^[a-f0-9]{7,40}$/.test(value));
}

function timestamp(value: unknown) {
  return typeof value === "string" && value.length <= 40 &&
    Number.isFinite(Date.parse(value));
}

function fingerprint(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}

function metricValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= 0 && value <= 600_000;
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
