import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EnterpriseMeetingCalendarSyncDto } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import { requestIdempotencyKey, routeUuid } from
  "./enterprise-meeting-route-input.js";
import type { EnterpriseMeetingCalendarSyncRecord } from
  "./enterprise-meeting-calendar.js";
import type { EnterpriseProviderReadinessService } from
  "./enterprise-provider-readiness.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseMeetingCalendarRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  readiness: EnterpriseProviderReadinessService,
) {
  app.get<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId/calendar-sync",
    async (request, reply) => {
      const access = await calendarAccess(request, reply, routeService, runtime,
        "meeting:read", "meeting.calendar_sync.read");
      if (!access) return;
      const meetingId = routeUuid(request.params.meetingId);
      if (!meetingId) return invalid(reply);
      if (!runtime.currentMeetingCalendarSync) return postgresRequired(reply);
      const result = await runtime.currentMeetingCalendarSync({
        context: context(access, request), meetingId,
      });
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "forbidden") return forbidden(reply);
      if (result.status !== "ready") return postgresRequired(reply);
      return reply.send({ sync: result.sync ? dto(result.sync) : null });
    },
  );

  app.post<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId/calendar-sync",
    async (request, reply) => {
      const access = await calendarAccess(request, reply, routeService, runtime,
        "meeting:write", "meeting.calendar_sync.request");
      if (!access) return;
      const meetingId = routeUuid(request.params.meetingId);
      const body = parseRequest(request.body);
      const idempotencyKey = requestIdempotencyKey(request);
      if (!meetingId || !body) return invalid(reply);
      if (!idempotencyKey) return sendError(reply, 400,
        "idempotency_key_required", "Idempotency-Key header is required");
      if (!runtime.requestMeetingCalendarSync) return postgresRequired(reply);
      const capability = (await readiness.getCapabilities({
        region: access.tenant.homeRegion,
      })).find((item) => item.capability === "calendar.meetings");
      if (!capability || capability.status !== "ready" ||
        capability.features.create !== true ||
        Date.parse(capability.expiresAt) <= Date.now()) {
        return notReady(reply, capability?.reasonCode ?? "calendar_provider_not_ready");
      }
      const result = await runtime.requestMeetingCalendarSync({
        context: context(access, request), meetingId,
        expectedMeetingVersion: body.expectedMeetingVersion,
        durationMinutes: body.durationMinutes, idempotencyKey, now: new Date(),
      });
      if (result.status === "created" || result.status === "replayed") {
        return reply.status(result.status === "created" ? 202 : 200).send({
          sync: dto(result.sync),
          ...(result.status === "replayed" ? { replayed: true } : {}),
        });
      }
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "forbidden") return forbidden(reply);
      if (result.status === "not_configured") {
        return notReady(reply, result.reasonCode ?? "calendar_provider_not_configured");
      }
      if (result.status === "not_scheduled") return sendError(reply, 409,
        "meeting_calendar_not_scheduled", "Only future scheduled meetings can sync");
      return sendError(reply, 409, result.status === "idempotency_conflict"
        ? "idempotency_conflict" : "meeting_calendar_sync_conflict",
      "Meeting calendar sync conflict");
    },
  );
}

async function calendarAccess(
  request: FastifyRequest, reply: FastifyReply, routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime, scope: "meeting:read" | "meeting:write",
  action: string,
) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope, {
    action, resourceType: "meeting_calendar_sync",
  });
  if (!access || !requireTenantRouteDocument(
    request, reply, routeService, access.tenant,
  )) return null;
  return access;
}
function context(
  access: NonNullable<Awaited<ReturnType<typeof calendarAccess>>>,
  request: FastifyRequest,
) { return createEnterpriseTenantContext({ tenantId: access.tenant.id,
  actorUserId: access.account.id, actorRole: access.member.role,
  traceId: enterpriseRequestTraceId(request) }); }
function parseRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).sort().join(",") !==
    ["durationMinutes", "expectedMeetingVersion"].sort().join(",") ||
    !positive(item.expectedMeetingVersion) || !Number.isSafeInteger(item.durationMinutes) ||
    Number(item.durationMinutes) < 15 || Number(item.durationMinutes) > 480) return null;
  return { expectedMeetingVersion: Number(item.expectedMeetingVersion),
    durationMinutes: Number(item.durationMinutes) };
}
function dto(sync: EnterpriseMeetingCalendarSyncRecord):
  EnterpriseMeetingCalendarSyncDto {
  return { id: sync.id, meetingId: sync.meetingId, provider: sync.provider,
    status: sync.status, scheduledStartAt: sync.scheduledStartAt,
    scheduledEndAt: sync.scheduledEndAt,
    ...(sync.providerEventId ? { providerEventId: sync.providerEventId } : {}),
    ...(sync.providerWebUrl ? { providerWebUrl: sync.providerWebUrl } : {}),
    attempts: sync.attempts,
    ...(sync.lastErrorCode ? { lastErrorCode: sync.lastErrorCode } : {}),
    createdAt: sync.createdAt, updatedAt: sync.updatedAt,
    ...(sync.syncedAt ? { syncedAt: sync.syncedAt } : {}), version: sync.version };
}
function positive(value: unknown) { return Number.isSafeInteger(value) && Number(value) > 0; }
function invalid(reply: FastifyReply) { return sendError(reply, 400,
  "invalid_meeting_calendar_sync", "Invalid meeting calendar sync request"); }
function notFound(reply: FastifyReply) { return sendError(reply, 404,
  "meeting_not_found", "Meeting not found"); }
function forbidden(reply: FastifyReply) { return sendError(reply, 403,
  "meeting_calendar_sync_forbidden", "Meeting calendar sync denied"); }
function notReady(reply: FastifyReply, reasonCode: string) { return sendError(reply, 503,
  "meeting_calendar_not_ready", `Meeting calendar not ready: ${reasonCode}`); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "Enterprise PostgreSQL runtime required"); }
