import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  enterpriseRequestTraceId,
  requireEnterpriseScope,
} from "./enterprise-auth.js";
import {
  parseScreenShareAcquire,
  parseScreenShareCommand,
  screenShareRequestHash,
} from "./enterprise-meeting-screen-share-route-input.js";
import type { EnterpriseMeetingScreenShareProvider } from
  "./enterprise-meeting-screen-share-provider.js";
import { createEnterpriseMeetingScreenShareToken } from
  "./enterprise-meeting-screen-share-token.js";
import {
  enterpriseMeetingScreenSharePublisherIdentity,
  enterpriseMeetingScreenShareRoomName,
  type EnterpriseMeetingScreenShareRecord,
  type EnterpriseMeetingScreenShareRevocation,
} from "./enterprise-meeting-screen-share.js";
import { enterpriseMeetingRtcCredentialsFor } from
  "./enterprise-meeting-rtc-token.js";
import { requestIdempotencyKey, routeUuid } from
  "./enterprise-meeting-route-input.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

type Command = "pause" | "resume" | "renew" | "stop";

export function registerEnterpriseMeetingScreenShareRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  provider: EnterpriseMeetingScreenShareProvider,
) {
  app.get<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId/screen-shares/current",
    async (request, reply) => {
      const access = await screenShareAccess(
        request, reply, routeService, runtime, "meeting.screen_share.read",
      );
      if (!access) return;
      const meetingId = routeUuid(request.params.meetingId);
      if (!meetingId) return invalid(reply);
      if (!runtime.currentMeetingScreenShare) return postgresRequired(reply);
      const result = await runtime.currentMeetingScreenShare({
        context: tenantContext(access, request), meetingId, now: new Date(),
      });
      const revocation = await revoke(
        provider, access.route.rtcUrl, result.revoked ?? [],
      );
      if (result.status !== "ready") return rejected(reply, result.status);
      return reply.send({
        share: result.share ? dto(result.share) : null,
        revocation,
      });
    },
  );

  app.post<{ Params: { meetingId: string } }>(
    "/enterprise/v1/meetings/:meetingId/screen-shares/acquire",
    async (request, reply) => {
      const access = await screenShareAccess(
        request, reply, routeService, runtime, "meeting.screen_share.acquire",
      );
      if (!access) return;
      const meetingId = routeUuid(request.params.meetingId);
      const body = parseScreenShareAcquire(request.body);
      const idempotencyKey = requestIdempotencyKey(request);
      if (!meetingId || !body) return invalid(reply);
      if (!idempotencyKey) return idempotencyRequired(reply);
      if (!runtime.acquireMeetingScreenShare) return postgresRequired(reply);
      if (!tokenReady(access.route.rtcUrl)) return providerNotReady(reply);
      const now = new Date();
      const result = await runtime.acquireMeetingScreenShare({
        context: tenantContext(access, request), meetingId, shareId: randomUUID(),
        ...body, idempotencyKey,
        requestHash: screenShareRequestHash({
          actorUserId: access.account.id, meetingId, command: "acquire", body,
        }),
        now,
      });
      const revocation = await revoke(
        provider, access.route.rtcUrl, result.revoked ?? [],
      );
      if (result.status === "busy") {
        return reply.status(409).send({
          error: { code: "screen_share_busy", message: "Screen share is busy" },
          share: dto(result.share), revocation,
        });
      }
      if (result.status !== "created" && result.status !== "replayed") {
        return rejected(reply, result.status);
      }
      const grant = await createEnterpriseMeetingScreenShareToken({
        tenantId: access.tenant.id, meetingId,
        participantId: result.share.participantId,
        participantName: "企业成员", rtcUrl: access.route.rtcUrl,
        share: result.share, now,
      });
      if (grant.status !== "ready") return providerNotReady(reply);
      return reply.status(result.status === "created" ? 201 : 200).send({
        share: dto(result.share), grant: grant.grant,
        ...(result.status === "replayed" ? { replayed: true } : {}),
        revocation,
      });
    },
  );

  for (const command of ["pause", "resume", "renew", "stop"] as const) {
    registerCommand(app, routeService, runtime, provider, command);
  }
}

function registerCommand(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
  provider: EnterpriseMeetingScreenShareProvider,
  command: Command,
) {
  app.post<{ Params: { meetingId: string; shareId: string } }>(
    `/enterprise/v1/meetings/:meetingId/screen-shares/:shareId/${command}`,
    async (request, reply) => {
      const access = await screenShareAccess(
        request, reply, routeService, runtime, `meeting.screen_share.${command}`,
      );
      if (!access) return;
      const meetingId = routeUuid(request.params.meetingId);
      const shareId = routeUuid(request.params.shareId);
      const body = parseScreenShareCommand(request.body, command);
      const idempotencyKey = requestIdempotencyKey(request);
      if (!meetingId || !shareId || !body) return invalid(reply);
      if (!idempotencyKey) return idempotencyRequired(reply);
      if (!runtime.commandMeetingScreenShare) return postgresRequired(reply);
      if (["resume", "renew"].includes(command) &&
        !tokenReady(access.route.rtcUrl)) return providerNotReady(reply);
      const now = new Date();
      const result = await runtime.commandMeetingScreenShare({
        context: tenantContext(access, request), meetingId, shareId, command,
        ...body, idempotencyKey,
        requestHash: screenShareRequestHash({
          actorUserId: access.account.id, meetingId, shareId, command, body,
        }),
        now,
      });
      const revocation = await revoke(
        provider, access.route.rtcUrl, result.revoked ?? [],
      );
      if (result.status !== "updated" && result.status !== "replayed") {
        return rejected(reply, result.status);
      }
      const grant = result.share.status === "active" &&
        ["resume", "renew"].includes(command)
        ? await createEnterpriseMeetingScreenShareToken({
            tenantId: access.tenant.id, meetingId,
            participantId: result.share.participantId,
            participantName: "企业成员", rtcUrl: access.route.rtcUrl,
            share: result.share, now,
          })
        : null;
      if (grant?.status === "not_ready") return providerNotReady(reply);
      return reply.send({
        share: dto(result.share),
        ...(grant?.status === "ready" ? { grant: grant.grant } : {}),
        ...(result.status === "replayed" ? { replayed: true } : {}),
        revocation,
      });
    },
  );
}

async function screenShareAccess(
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
  return { ...access, route: route.document };
}

function tenantContext(
  access: NonNullable<Awaited<ReturnType<typeof screenShareAccess>>>,
  request: FastifyRequest,
) {
  return createEnterpriseTenantContext({
    tenantId: access.tenant.id, actorUserId: access.account.id,
    actorRole: access.member.role, traceId: enterpriseRequestTraceId(request),
  });
}

function dto(share: EnterpriseMeetingScreenShareRecord) {
  return {
    id: share.id, meetingId: share.meetingId, participantId: share.participantId,
    communicationSessionId: share.communicationSessionId,
    sourceType: share.sourceType, includesSystemAudio: share.includesSystemAudio,
    qualityMode: share.qualityMode, status: share.status,
    generation: share.generation,
    publisherIdentity: enterpriseMeetingScreenSharePublisherIdentity({
      shareId: share.id, generation: share.generation,
    }),
    ...(share.trackSid ? { trackSid: share.trackSid } : {}),
    ...(share.leaseExpiresAt ? { leaseExpiresAt: share.leaseExpiresAt } : {}),
    startedAt: share.startedAt,
    ...(share.pausedAt ? { pausedAt: share.pausedAt } : {}),
    ...(share.endedAt ? { endedAt: share.endedAt } : {}),
    createdAt: share.createdAt, updatedAt: share.updatedAt, version: share.version,
  };
}

async function revoke(
  provider: EnterpriseMeetingScreenShareProvider,
  rtcUrl: string,
  revocations: EnterpriseMeetingScreenShareRevocation[],
) {
  if (revocations.length === 0) return "not_required" as const;
  const results = await Promise.all(revocations.map((item) => provider.revoke({
    rtcUrl,
    roomName: enterpriseMeetingScreenShareRoomName(item.communicationSessionId),
    publisherIdentity: item.publisherIdentity,
  })));
  return results.every((result) => result.status === "completed")
    ? "completed" as const : "pending" as const;
}

function tokenReady(rtcUrl: string) {
  return enterpriseMeetingRtcCredentialsFor(rtcUrl).status === "ready";
}
function rejected(reply: FastifyReply, status: string) {
  if (status === "not_found") {
    return sendError(reply, 404, "screen_share_not_found", "Screen share not found");
  }
  if (["forbidden", "policy_denied"].includes(status)) {
    return sendError(reply, 403, "screen_share_forbidden", "Screen share denied");
  }
  if (["busy", "capacity_denied", "conflict", "idempotency_conflict",
    "invalid_transition", "expired", "not_joinable"].includes(status)) {
    return sendError(reply, 409, "screen_share_conflict", "Screen share conflict");
  }
  return sendError(reply, 503, "screen_share_not_ready", "Screen share not ready");
}
function invalid(reply: FastifyReply) {
  return sendError(reply, 400, "invalid_screen_share_request", "Invalid request");
}
function idempotencyRequired(reply: FastifyReply) {
  return sendError(reply, 400, "idempotency_key_required", "Idempotency key required");
}
function postgresRequired(reply: FastifyReply) {
  return sendError(reply, 503, "enterprise_postgres_required",
    "PostgreSQL enterprise runtime required");
}
function providerNotReady(reply: FastifyReply) {
  return sendError(reply, 503, "screen_share_provider_not_ready",
    "Screen share provider not ready");
}
