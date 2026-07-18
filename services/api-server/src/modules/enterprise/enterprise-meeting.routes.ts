import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  enterpriseRequestTraceId,
  requireEnterpriseScope,
} from "./enterprise-auth.js";
import type { EnterpriseMeetingInviteTokenService } from
  "./enterprise-meeting-invite-token.js";
import {
  meetingInvitationRequestHash,
  meetingRequestHash,
  parseGuestInvitation,
  parseGuestJoin,
  parseMeetingCreate,
  parseMemberJoin,
  parseTranslationPreference,
  requestIdempotencyKey,
  routeUuid,
  tenantMatches,
} from "./enterprise-meeting-route-input.js";
import {
  enterpriseMeetingDto,
  enterpriseMeetingParticipantDto,
} from "./enterprise-meeting-route-output.js";
import { issueEnterpriseMeetingJoinToken } from
  "./enterprise-meeting-join-token.js";
import type { EnterpriseMeetingTranslationDispatchService } from
  "./enterprise-meeting-translation-dispatch.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { registerEnterpriseMeetingTranslationWorkerRoutes } from
  "./enterprise-meeting-translation-worker.routes.js";
export async function registerEnterpriseMeetingRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  inviteTokens: EnterpriseMeetingInviteTokenService,
  translationDispatch: EnterpriseMeetingTranslationDispatchService,
) {
  registerEnterpriseMeetingTranslationWorkerRoutes(app, runtime);
  app.get("/enterprise/v1/meetings", async (request, reply) => {
    const access = await meetingAccess(
      request, reply, routeService, runtime, "meeting:read", "meeting.list",
    );
    if (!access) return;
    if (!runtime.listMeetings) return postgresRequired(reply);
    const result = await runtime.listMeetings({ context: context(access, request) });
    if (result.status === "storage_required") return postgresRequired(reply);
    return reply.send({ meetings: result.meetings.map(enterpriseMeetingDto) });
  });
  app.get<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId",
    async (request, reply) => {
      const access = await meetingAccess(
        request, reply, routeService, runtime, "meeting:read", "meeting.read",
      );
      if (!access) return;
      if (!runtime.getMeeting) return postgresRequired(reply);
      const meetingId = routeUuid(request.params.meetingId);
      if (!meetingId) return invalid(reply, "invalid_meeting_id");
      const result = await runtime.getMeeting({
        context: context(access, request), meetingId,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      return reply.send({ meeting: enterpriseMeetingDto(result.aggregate) });
    },
  );
  app.post("/enterprise/v1/meetings", async (request, reply) => {
    const access = await meetingAccess(
      request, reply, routeService, runtime, "meeting:write", "meeting.create",
    );
    if (!access) return;
    if (!runtime.createMeetingSession) return postgresRequired(reply);
    const idempotencyKey = requestIdempotencyKey(request);
    if (!idempotencyKey) {
      return invalid(reply, "idempotency_key_required", "Idempotency key required");
    }
    const now = Date.now();
    const body = parseMeetingCreate(request.body, now);
    if (!body) return invalid(reply, "invalid_meeting");
    if (!tenantMatches(body.tenantId, access.tenant.id)) return mismatch(reply);
    const createdAt = new Date(now).toISOString();
    const meetingId = randomUUID();
    const result = await runtime.createMeetingSession({
      context: context(access, request),
      meeting: {
        id: meetingId,
        title: body.title,
        hostUserId: access.account.id,
        ...(body.scheduledAt ? { scheduledAt: body.scheduledAt } : {}),
        status: body.scheduledAt && Date.parse(body.scheduledAt) > now
          ? "scheduled" : "provisioning",
        policy: body.policy,
        retentionUntil: new Date(
          now + access.tenant.dataRetentionDays * 86_400_000,
        ).toISOString(),
        createdAt,
        idempotencyKey,
        requestHash: meetingRequestHash(access.account.id, body),
      },
      hostParticipantId: randomUUID(),
      bindingId: randomUUID(),
      communicationSessionId: randomUUID(),
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    if (result.status === "idempotency_conflict") {
      return sendError(reply, 409, "idempotency_conflict", "Idempotency conflict");
    }
    if (result.status === "policy_not_ready" ||
      result.status === "entitlement_not_ready" ||
      result.status === "route_not_ready") return meetingNotReady(reply, result.status);
    if (!("aggregate" in result)) return meetingNotReady(reply, result.status);
    return reply.status(result.status === "created" ? 201 : 200).send({
      meeting: enterpriseMeetingDto(result.aggregate),
      ...(result.status === "replayed" ? { replayed: true } : {}),
    });
  });
  app.post<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId/invitations",
    async (request, reply) => {
      const access = await meetingAccess(
        request, reply, routeService, runtime, "meeting:write", "meeting.invite",
      );
      if (!access) return;
      if (!runtime.inviteMeetingGuest) return postgresRequired(reply);
      const meetingId = routeUuid(request.params.meetingId);
      const body = parseGuestInvitation(request.body);
      if (!meetingId || !body) return invalid(reply, "invalid_meeting_invitation");
      if (!tenantMatches(body.tenantId, access.tenant.id)) return mismatch(reply);
      const idempotencyKey = requestIdempotencyKey(request);
      if (!idempotencyKey) {
        return invalid(reply, "idempotency_key_required", "Idempotency key required");
      }
      const participantId = randomUUID();
      const prepared = inviteTokens.issue({
        tenantId: access.tenant.id, meetingId, participantId,
      });
      if (prepared.status === "not_ready") {
        return meetingNotReady(reply, prepared.reason);
      }
      const result = await runtime.inviteMeetingGuest({
        context: context(access, request),
        participant: {
          id: participantId,
          meetingId,
          externalIdentity: `guest:${participantId}`,
          role: "guest",
          displayName: body.displayName,
          ...(body.language ? { language: body.language } : {}),
        },
        idempotencyKey,
        requestHash: meetingInvitationRequestHash(
          access.account.id, meetingId, body,
        ),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "forbidden") {
        return sendError(reply, 403, "meeting_invitation_forbidden", "Invitation denied");
      }
      if (result.status === "not_joinable" || result.status === "conflict") {
        return sendError(reply, 409, "meeting_invitation_conflict", "Invitation conflict");
      }
      if (!("participant" in result)) return meetingNotReady(reply, result.status);
      const invitation = result.participant.id === participantId
        ? prepared : inviteTokens.issue({
            tenantId: access.tenant.id,
            meetingId,
            participantId: result.participant.id,
          });
      if (invitation.status === "not_ready") {
        return meetingNotReady(reply, invitation.reason);
      }
      return reply.status(result.status === "created" ? 201 : 200).send({ invitation: {
        meetingId,
        participantId: result.participant.id,
        token: invitation.token,
        expiresAt: invitation.claims.expiresAt,
      }, ...(result.status === "replayed" ? { replayed: true } : {}) });
    },
  );
  app.put<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId/translation-preference",
    async (request, reply) => {
      const access = await meetingAccess(
        request, reply, routeService, runtime, "meeting:read",
        "meeting.translation_preference.update",
      );
      if (!access) return;
      if (!runtime.updateMeetingTranslationPreference) return postgresRequired(reply);
      const meetingId = routeUuid(request.params.meetingId);
      const body = parseTranslationPreference(request.body);
      if (!meetingId || !body) return invalid(reply, "invalid_translation_preference");
      if (!tenantMatches(body.tenantId, access.tenant.id)) return mismatch(reply);
      const result = await runtime.updateMeetingTranslationPreference({
        context: context(access, request),
        meetingId,
        captionLanguage: body.captionLanguage,
        translatedAudioEnabled: body.translatedAudioEnabled,
        expectedVersion: body.expectedVersion,
      });
      if (result.status === "not_found") return notFound(reply);
      if (result.status === "forbidden") {
        return sendError(reply, 403, "translation_preference_forbidden",
          "Translation preference denied");
      }
      if (result.status === "conflict") {
        return sendError(reply, 409, "translation_preference_conflict",
          "Translation preference version conflict");
      }
      if (result.status !== "updated") return joinRejected(reply, result.status);
      return reply.send({
        participant: enterpriseMeetingParticipantDto(result.participant),
      });
    },
  );
  app.post<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId/join",
    async (request, reply) => {
      const access = await meetingAccess(
        request, reply, routeService, runtime, "meeting:read", "meeting.join",
      );
      if (!access) return;
      if (!runtime.authorizeMemberMeetingJoin) return postgresRequired(reply);
      const meetingId = routeUuid(request.params.meetingId);
      const body = parseMemberJoin(request.body);
      if (!meetingId || !body) return invalid(reply, "invalid_meeting_join");
      if (!tenantMatches(body.tenantId, access.tenant.id)) return mismatch(reply);
      const tenantContext = context(access, request);
      const result = await runtime.authorizeMemberMeetingJoin({
        context: tenantContext,
        meetingId,
        participantId: randomUUID(),
        displayName: body.displayName,
        ...(body.language ? { language: body.language } : {}),
        ...(body.captionLanguage
          ? { captionLanguage: body.captionLanguage } : {}),
        ...(body.translatedAudioEnabled !== undefined
          ? { translatedAudioEnabled: body.translatedAudioEnabled } : {}),
        now: new Date().toISOString(),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status !== "authorized") return joinRejected(reply, result.status);
      return issueEnterpriseMeetingJoinToken(
        reply, routeService, runtime, translationDispatch,
        tenantContext,
        result.authorization);
    },
  );
  app.post<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId/guest-join",
    async (request, reply) => {
      if (!runtime.authorizeGuestMeetingJoin) return postgresRequired(reply);
      const meetingId = routeUuid(request.params.meetingId);
      const body = parseGuestJoin(request.body);
      if (!meetingId || !body) return invalid(reply, "invalid_meeting_join");
      const verified = inviteTokens.verify(body.token, meetingId);
      if (verified.status === "not_ready") {
        return meetingNotReady(reply, "invite_signing_not_configured");
      }
      if (verified.status !== "verified") {
        return sendError(reply, 401, "meeting_invitation_rejected", "Invitation rejected");
      }
      const tenantContext = createEnterpriseTenantContext({
        tenantId: verified.claims.tenantId,
        actorUserId: `guest:${verified.claims.participantId}`,
        traceId: enterpriseRequestTraceId(request),
      });
      const result = await runtime.authorizeGuestMeetingJoin({
        context: tenantContext,
        meetingId,
        participantId: verified.claims.participantId,
        ...(body.captionLanguage
          ? { captionLanguage: body.captionLanguage } : {}),
        ...(body.translatedAudioEnabled !== undefined
          ? { translatedAudioEnabled: body.translatedAudioEnabled } : {}),
        now: new Date().toISOString(),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status !== "authorized") return joinRejected(reply, result.status);
      return issueEnterpriseMeetingJoinToken(
        reply, routeService, runtime, translationDispatch,
        tenantContext,
        result.authorization);
    },
  );
}
async function meetingAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  scope: "meeting:read" | "meeting:write",
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
    tenantId: access.tenant.id,
    actorUserId: access.account.id,
    actorRole: access.member.role,
    traceId: enterpriseRequestTraceId(request),
  });
}

function joinRejected(reply: FastifyReply, status: string) {
  if (status === "not_found") return notFound(reply);
  if (status === "not_started") {
    return sendError(reply, 409, "meeting_not_started", "Meeting not started");
  }
  if (status === "not_joinable") {
    return sendError(reply, 409, "meeting_not_joinable", "Meeting not joinable");
  }
  return meetingNotReady(reply, "meeting_session_not_ready");
}
function postgresRequired(reply: FastifyReply) {
  return sendError(reply, 503, "enterprise_postgres_required",
    "PostgreSQL enterprise runtime required");
}
function meetingNotReady(reply: FastifyReply, reasonCode: string) {
  return sendError(reply, 503, "meeting_not_ready", `Meeting not ready: ${reasonCode}`);
}
function mismatch(reply: FastifyReply) {
  return sendError(reply, 409, "tenant_context_mismatch", "Tenant context mismatch");
}
function notFound(reply: FastifyReply) {
  return sendError(reply, 404, "meeting_not_found", "Meeting not found");
}
function invalid(reply: FastifyReply, code: string, message = "Invalid meeting request") {
  return sendError(reply, 400, code, message);
}
