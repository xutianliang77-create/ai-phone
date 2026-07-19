import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import { enterpriseMeetingMaterialDto } from "./enterprise-meeting-material.js";
import type { EnterpriseMeetingMaterialRecord } from
  "./enterprise-meeting-material.js";
import type { EnterpriseMeetingMaterialProvider } from
  "./enterprise-meeting-material-provider.js";
import { requestIdempotencyKey, routeUuid, tenantMatches } from
  "./enterprise-meeting-route-input.js";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseMeetingMaterialRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  provider: EnterpriseMeetingMaterialProvider,
) {
  app.get<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId/materials/current",
    async (request, reply) => {
      const access = await materialAccess(
        request, reply, routeService, runtime, "meeting:read", "meeting.material.read",
      );
      if (!access) return;
      if (!runtime.currentMeetingMaterial) return postgresRequired(reply);
      const meetingId = routeUuid(request.params.meetingId);
      if (!meetingId) return invalid(reply);
      const result = await runtime.currentMeetingMaterial({
        context: context(access, request), meetingId,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      return reply.send({
        material: result.material ? enterpriseMeetingMaterialDto(result.material) : null,
      });
    },
  );

  app.post<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId/end",
    async (request, reply) => {
      const access = await materialAccess(
        request, reply, routeService, runtime, "meeting:write", "meeting.end",
      );
      if (!access) return;
      if (!runtime.endMeetingForMaterials) return postgresRequired(reply);
      const meetingId = routeUuid(request.params.meetingId);
      const body = parseVersionBody(request.body);
      if (!meetingId || !body || !tenantMatches(body.tenantId, access.tenant.id)) {
        return invalid(reply);
      }
      const result = await runtime.endMeetingForMaterials({
        context: context(access, request), meetingId,
        expectedVersion: body.expectedVersion, occurredAt: new Date().toISOString(),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "forbidden") return forbidden(reply);
      if (result.status === "screen_share_active") {
        return sendError(reply, 409, "meeting_screen_share_active",
          "Stop the active screen share before ending the meeting");
      }
      if (result.status !== "ended") return conflict(reply, result.status);
      return reply.send({ meetingId, status: "ended", version: result.meetingVersion });
    },
  );

  app.post<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId/materials/generate",
    async (request, reply) => {
      const access = await materialAccess(
        request, reply, routeService, runtime, "meeting:write",
        "meeting.material.generate",
      );
      if (!access) return;
      if (!runtime.prepareMeetingMaterial || !runtime.finalizeMeetingMaterial ||
        !runtime.getMeeting) return postgresRequired(reply);
      const meetingId = routeUuid(request.params.meetingId);
      const body = parseGenerateBody(request.body);
      const idempotencyKey = requestIdempotencyKey(request);
      if (!meetingId || !body || !idempotencyKey ||
        !tenantMatches(body.tenantId, access.tenant.id)) return invalid(reply);
      const tenantContext = context(access, request);
      const occurredAt = new Date().toISOString();
      const prepared = await runtime.prepareMeetingMaterial({
        context: tenantContext, meetingId,
        expectedMeetingVersion: body.expectedMeetingVersion, idempotencyKey,
        requestHash: materialRequestHash(
          access.account.id, meetingId, body.expectedMeetingVersion,
        ),
        occurredAt,
      });
      if (prepared.status === "storage_required") return postgresRequired(reply);
      if (prepared.status === "not_found") return notFound(reply);
      if (prepared.status === "forbidden") return forbidden(reply);
      if (prepared.status === "not_ended") {
        return sendError(reply, 409, "meeting_not_ended",
          "Meeting must be ended before materials are generated");
      }
      if (prepared.status === "no_source_events") {
        return sendError(reply, 409, "meeting_material_source_empty",
          "No finalized meeting transcript events are available");
      }
      if (prepared.status === "idempotency_conflict") {
        return conflict(reply, prepared.status);
      }
      if (prepared.status === "conflict") return conflict(reply, prepared.status);
      if (!("run" in prepared)) return conflict(reply, prepared.status);
      if (prepared.finalized && "material" in prepared) {
        return reply.send({
          material: enterpriseMeetingMaterialDto(prepared.material), replayed: true,
        });
      }
      const aggregate = await runtime.getMeeting({ context: tenantContext, meetingId });
      if (aggregate.status !== "ready") return conflict(reply, aggregate.status);
      const review = await provider.generate({
        meetingId, title: aggregate.aggregate.meeting.title,
        segments: prepared.segments,
        participants: aggregate.aggregate.participants,
      });
      const finalized = await runtime.finalizeMeetingMaterial({
        context: tenantContext, meetingId, runId: prepared.run.id,
        expectedVersion: prepared.run.version, sourceHash: prepared.run.sourceHash,
        segments: prepared.segments, review, occurredAt: new Date().toISOString(),
      });
      if (finalized.status === "storage_required") return postgresRequired(reply);
      if (finalized.status === "not_found") return notFound(reply);
      if (finalized.status === "conflict") return conflict(reply, finalized.status);
      if (!("material" in finalized)) return conflict(reply, finalized.status);
      return reply.status(prepared.status === "created" ? 201 : 200).send({
        material: enterpriseMeetingMaterialDto(finalized.material),
        ...(prepared.status === "replayed" || finalized.status === "replayed"
          ? { replayed: true } : {}),
      });
    },
  );

  app.post<{ Params: { meetingId: string; runId: string } }>(
    "/enterprise/v1/meetings/:meetingId/materials/:runId/publish",
    async (request, reply) => {
      const access = await materialAccess(
        request, reply, routeService, runtime, "meeting:write",
        "meeting.material.publish",
      );
      if (!access) return;
      if (!runtime.publishMeetingMaterial) return postgresRequired(reply);
      const ids = routeIds(request.params);
      const body = parseVersionBody(request.body);
      if (!ids || !body || !tenantMatches(body.tenantId, access.tenant.id)) {
        return invalid(reply);
      }
      const result = await runtime.publishMeetingMaterial({
        context: context(access, request), ...ids,
        expectedVersion: body.expectedVersion, occurredAt: new Date().toISOString(),
      });
      return materialMutation(reply, result);
    },
  );

  app.put<{ Params: { meetingId: string; runId: string; participantId: string } }>(
    "/enterprise/v1/meetings/:meetingId/materials/:runId/speakers/:participantId",
    async (request, reply) => {
      const access = await materialAccess(
        request, reply, routeService, runtime, "meeting:write",
        "meeting.material.speaker_label.update",
      );
      if (!access) return;
      if (!runtime.updateMeetingMaterialSpeaker) return postgresRequired(reply);
      const ids = routeIds(request.params);
      const participantId = routeUuid(request.params.participantId);
      const body = parseSpeakerBody(request.body);
      if (!ids || !participantId || !body ||
        !tenantMatches(body.tenantId, access.tenant.id)) return invalid(reply);
      const result = await runtime.updateMeetingMaterialSpeaker({
        context: context(access, request), ...ids, participantId,
        displayName: body.displayName, expectedVersion: body.expectedVersion,
        occurredAt: new Date().toISOString(),
      });
      return materialMutation(reply, result);
    },
  );

  app.put<{ Params: { meetingId: string; runId: string; actionItemId: string } }>(
    "/enterprise/v1/meetings/:meetingId/materials/:runId/actions/:actionItemId",
    async (request, reply) => {
      const access = await materialAccess(
        request, reply, routeService, runtime, "meeting:write",
        "meeting.material.action.update",
      );
      if (!access) return;
      if (!runtime.updateMeetingMaterialAction) return postgresRequired(reply);
      const ids = routeIds(request.params);
      const actionItemId = routeUuid(request.params.actionItemId);
      const body = parseActionBody(request.body);
      if (!ids || !actionItemId || !body ||
        !tenantMatches(body.tenantId, access.tenant.id)) return invalid(reply);
      const result = await runtime.updateMeetingMaterialAction({
        context: context(access, request), ...ids, actionItemId,
        status: body.status, expectedVersion: body.expectedVersion,
        occurredAt: new Date().toISOString(),
      });
      return materialMutation(reply, result);
    },
  );
}

async function materialAccess(
  request: FastifyRequest, reply: FastifyReply, routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime, scope: "meeting:read" | "meeting:write",
  action: string,
) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope, {
    action, resourceType: "meeting",
  });
  if (!access || !requireTenantRouteDocument(
    request, reply, routeService, access.tenant,
  )) return null;
  return access;
}
function context(
  access: NonNullable<Awaited<ReturnType<typeof requireEnterpriseScope>>>,
  request: FastifyRequest,
) {
  return createEnterpriseTenantContext({
    tenantId: access.tenant.id, actorUserId: access.account.id,
    actorRole: access.member.role, traceId: enterpriseRequestTraceId(request),
  });
}
function parseVersionBody(
  value: unknown,
  allowed = ["tenantId", "expectedVersion"],
) {
  const body = object(value);
  if (!body || !keys(body, allowed) ||
    !positive(body.expectedVersion) ||
    body.tenantId !== undefined && typeof body.tenantId !== "string") return null;
  return { tenantId: body.tenantId as string | undefined,
    expectedVersion: body.expectedVersion as number };
}
function parseGenerateBody(value: unknown) {
  const body = object(value);
  const allowed = ["tenantId", "expectedMeetingVersion"];
  if (!body || !keys(body, allowed) || !positive(body.expectedMeetingVersion) ||
    body.tenantId !== undefined && typeof body.tenantId !== "string") return null;
  return { tenantId: body.tenantId as string | undefined,
    expectedMeetingVersion: body.expectedMeetingVersion as number };
}
function parseSpeakerBody(value: unknown) {
  const body = object(value);
  const allowed = ["tenantId", "expectedVersion", "displayName"];
  const base = parseVersionBody(value, allowed);
  if (!body || !base || !keys(body, allowed) ||
    typeof body.displayName !== "string" || !body.displayName.trim() ||
    Array.from(body.displayName.trim()).length > 120) return null;
  return { ...base, displayName: body.displayName.trim() };
}
function parseActionBody(value: unknown) {
  const body = object(value);
  const allowed = ["tenantId", "expectedVersion", "status"];
  const base = parseVersionBody(value, allowed);
  if (!body || !base || !keys(body, allowed) ||
    !["open", "completed", "cancelled"].includes(String(body.status))) return null;
  return { ...base, status: body.status as "open" | "completed" | "cancelled" };
}
function routeIds(value: { meetingId: string; runId: string }) {
  const meetingId = routeUuid(value.meetingId); const runId = routeUuid(value.runId);
  return meetingId && runId ? { meetingId, runId } : null;
}
function materialRequestHash(actorId: string, meetingId: string, version: number) {
  return createHash("sha256").update(JSON.stringify({
    actorId, meetingId, expectedMeetingVersion: version,
  })).digest("hex");
}
function materialMutation(reply: FastifyReply, result: {
  status: string;
  material?: EnterpriseMeetingMaterialRecord;
}) {
  if (result.status === "storage_required") return postgresRequired(reply);
  if (result.status === "not_found") return notFound(reply);
  if (result.status === "forbidden") return forbidden(reply);
  if (result.status === "review_not_ready") {
    return sendError(reply, 409, "meeting_material_review_not_ready",
      "Meeting material review is not ready for publication");
  }
  if (result.status === "conflict") return conflict(reply, result.status);
  if (!result.material) return conflict(reply, result.status);
  return reply.send({ material: enterpriseMeetingMaterialDto(result.material) });
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function positive(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}
function postgresRequired(reply: FastifyReply) {
  return sendError(reply, 503, "enterprise_postgres_required",
    "PostgreSQL enterprise runtime required");
}
function invalid(reply: FastifyReply) {
  return sendError(reply, 400, "invalid_meeting_material", "Invalid meeting material request");
}
function notFound(reply: FastifyReply) {
  return sendError(reply, 404, "meeting_material_not_found", "Meeting material not found");
}
function forbidden(reply: FastifyReply) {
  return sendError(reply, 403, "meeting_material_forbidden", "Meeting material denied");
}
function conflict(reply: FastifyReply, reason: string) {
  return sendError(reply, 409, "meeting_material_conflict", `Meeting material conflict: ${reason}`);
}
