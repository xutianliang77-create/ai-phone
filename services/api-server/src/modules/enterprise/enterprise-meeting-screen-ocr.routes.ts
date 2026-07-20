import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  enterpriseRequestTraceId,
  requireEnterpriseScope,
} from "./enterprise-auth.js";
import type { EnterpriseMeetingScreenOcrDispatchService } from
  "./enterprise-meeting-screen-ocr-dispatch.js";
import {
  parseScreenOcrDisable,
  parseScreenOcrEnable,
  screenOcrRequestHash,
} from "./enterprise-meeting-screen-ocr-route-input.js";
import { screenOcrResponse } from
  "./enterprise-meeting-screen-ocr-route-output.js";
import { requestIdempotencyKey, routeUuid } from
  "./enterprise-meeting-route-input.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { registerEnterpriseMeetingScreenOcrWorkerRoutes } from
  "./enterprise-meeting-screen-ocr-worker.routes.js";
import { recordEnterpriseReleaseOutcome, requireEnterpriseReleaseCapability } from
  "./enterprise-release-control.guard.js";

export function registerEnterpriseMeetingScreenOcrRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  dispatch: EnterpriseMeetingScreenOcrDispatchService,
) {
  app.get<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId/screen-ocr/current",
    async (request, reply) => {
      const access = await screenOcrAccess(request, reply, routeService, runtime,
        "meeting.screen_ocr.read");
      if (!access) return;
      const meetingId = routeUuid(request.params.meetingId);
      if (!meetingId) return invalid(reply);
      if (!runtime.currentMeetingScreenOcr) return postgresRequired(reply);
      const result = await runtime.currentMeetingScreenOcr({
        context: tenantContext(access, request), meetingId,
      });
      if (result.status !== "ready") return rejected(reply, result.status);
      return reply.send(screenOcrResponse(result.view));
    },
  );

  app.post<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId/screen-ocr/enable",
    async (request, reply) => {
      const access = await screenOcrAccess(request, reply, routeService, runtime,
        "meeting.screen_ocr.enable");
      if (!access) return;
      const meetingId = routeUuid(request.params.meetingId);
      const body = parseScreenOcrEnable(request.body);
      const idempotencyKey = requestIdempotencyKey(request);
      if (!meetingId || !body) return invalid(reply);
      if (!idempotencyKey) return idempotencyRequired(reply);
      if (!runtime.enableMeetingScreenOcr ||
        !runtime.updateMeetingScreenOcrRunStatus) return postgresRequired(reply);
      const context = tenantContext(access, request);
      if (!await requireEnterpriseReleaseCapability(
        reply, runtime, context, "meeting.screen_ocr",
      )) return;
      const result = await runtime.enableMeetingScreenOcr({
        context, meetingId, ...body, idempotencyKey,
        requestHash: screenOcrRequestHash({
          actorUserId: access.account.id, meetingId, command: "enable", body,
        }), now: new Date(),
      });
      if (result.status !== "created" && result.status !== "replayed") {
        return rejected(reply, result.status);
      }
      let view = result.view;
      if (result.dispatch) {
        const dispatched = await dispatch.ensure(result.dispatch);
        const recorded = await recordEnterpriseReleaseOutcome({ runtime, context,
          capability: "meeting.screen_ocr", operationId: result.dispatch.run.id,
          outcome: dispatched.status === "ready" ? "success" : "failure",
          actorId: "system:meeting-screen-ocr-dispatch" });
        if (!recorded) return rejected(reply, "release_outcome_not_recorded");
        if (dispatched.status !== "ready") {
          await runtime.updateMeetingScreenOcrRunStatus({
            context, meetingId, runId: result.dispatch.run.id,
            expectedVersion: result.dispatch.run.version,
            status: dispatched.status, reasonCode: dispatched.reasonCode,
            now: new Date(),
          });
          const refreshed = await runtime.currentMeetingScreenOcr?.({
            context, meetingId,
          });
          if (refreshed?.status === "ready") view = refreshed.view;
        }
      }
      return reply.status(result.status === "created" ? 201 : 200).send(
        screenOcrResponse(view, result.status === "replayed"),
      );
    },
  );

  app.post<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId/screen-ocr/disable",
    async (request, reply) => {
      const access = await screenOcrAccess(request, reply, routeService, runtime,
        "meeting.screen_ocr.disable");
      if (!access) return;
      const meetingId = routeUuid(request.params.meetingId);
      const body = parseScreenOcrDisable(request.body);
      const idempotencyKey = requestIdempotencyKey(request);
      if (!meetingId || !body) return invalid(reply);
      if (!idempotencyKey) return idempotencyRequired(reply);
      if (!runtime.disableMeetingScreenOcr) return postgresRequired(reply);
      const result = await runtime.disableMeetingScreenOcr({
        context: tenantContext(access, request), meetingId, ...body,
        idempotencyKey, requestHash: screenOcrRequestHash({
          actorUserId: access.account.id, meetingId, command: "disable", body,
        }), now: new Date(),
      });
      if (result.status !== "updated" && result.status !== "replayed") {
        return rejected(reply, result.status);
      }
      return reply.send(screenOcrResponse(
        result.view, result.status === "replayed",
      ));
    },
  );

  registerEnterpriseMeetingScreenOcrWorkerRoutes(app, runtime);
}

async function screenOcrAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  action: string,
) {
  const access = await requireEnterpriseScope(
    request, reply, runtime, "meeting:read", { action, resourceType: "meeting" },
  );
  if (!access || !requireTenantRouteDocument(
    request, reply, routeService, access.tenant,
  )) return null;
  const route = routeService.issue({
    tenantId: access.tenant.id, homeRegion: access.tenant.homeRegion,
    cellId: access.tenant.cellId ?? "", routeEpoch: access.tenant.version,
  });
  if (route.status !== "ready") {
    sendError(reply, 503, "route_not_ready", "Tenant route not ready");
    return null;
  }
  return access;
}

function tenantContext(
  access: NonNullable<Awaited<ReturnType<typeof screenOcrAccess>>>,
  request: FastifyRequest,
) {
  return createEnterpriseTenantContext({
    tenantId: access.tenant.id, actorUserId: access.account.id,
    actorRole: access.member.role, traceId: enterpriseRequestTraceId(request),
  });
}

function rejected(reply: FastifyReply, status: string) {
  const mapping: Record<string, [number, string]> = {
    not_found: [404, "screen_ocr_not_found"],
    forbidden: [403, "screen_ocr_forbidden"],
    not_active: [409, "screen_ocr_share_not_active"],
    policy_denied: [403, "screen_ocr_policy_denied"],
    entitlement_not_ready: [503, "screen_ocr_entitlement_not_ready"],
    route_not_ready: [503, "route_not_ready"],
    conflict: [409, "screen_ocr_conflict"],
    idempotency_conflict: [409, "idempotency_conflict"],
    release_outcome_not_recorded: [503, "release_outcome_not_recorded"],
  };
  const [code, reason] = mapping[status] ?? [503, "enterprise_postgres_required"];
  return sendError(reply, code, reason, "Meeting screen OCR request rejected");
}
function invalid(reply: FastifyReply) {
  return sendError(reply, 400, "invalid_screen_ocr_request",
    "Invalid meeting screen OCR request");
}
function idempotencyRequired(reply: FastifyReply) {
  return sendError(reply, 400, "idempotency_key_required",
    "Idempotency-Key header is required");
}
function postgresRequired(reply: FastifyReply) {
  return sendError(reply, 503, "enterprise_postgres_required",
    "Enterprise PostgreSQL runtime required");
}
