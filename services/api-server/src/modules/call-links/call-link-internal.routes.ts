import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { StorageConflictError } from "../../infrastructure/storage/sqlite-snapshot-store.js";
import { InboxPayloadConflictError } from "../events/reliable-events.repository.js";
import {
  findProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import { SessionVersionConflictError } from "../sessions/sessions-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { getReadyVoiceProfileTtsConfig } from "../voice-profiles/voice-profiles.service.js";
import { getCallLinkWorkerSupervisor } from "./call-link-worker-supervisor.js";
import {
  type CallLinkRecord,
  findCallLink,
  registerCallLeg,
} from "./call-links.service.js";
import { parseCallRoomEventRequest } from "./call-room-event-request.js";
import { createCallRoomToken } from "./call-room-token.js";
import { loadEnv } from "../../config/env.js";
import {
  deliverPendingCallRoomDataEvents,
  publishCallRoomDataEvents,
} from "./call-room-worker.js";
import { CallPlaybackConflictError } from "./call-playbacks.repository.js";
import { consumeCallRoomEventRequest } from "./call-room-event-rate-limit.js";
import { getCallRoomResourceLimits } from "./call-room-resource-limits.js";
import { liveKitSipParticipantIdentity } from "./livekit-sip-identity.js";
import {
  markLiveKitSipAnswered,
  observeLiveKitSipCompletion,
} from "./livekit-sip-reconciliation.js";
import { closeLiveKitSipInbound } from "./call-link-sip-inbound.routes.js";

export function registerCallLinkInternalRoutes(app: FastifyInstance) {
  const limits = getCallRoomResourceLimits();
  app.post("/internal/call-links/:callId/events", {
    bodyLimit: limits.maxDataPacketBytes * limits.maxEventsPerRequest + 8192,
  }, async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(reply, 401, "internal_error", "Unauthorized internal request");
    }
    const params = request.params as { callId: string };
    if (!consumeCallRoomEventRequest(params.callId)) {
      return sendError(
        reply,
        429,
        "call_room_event_rate_limited",
        "Call room event rate limit exceeded",
      );
    }
    return withSessionWriteLock(params.callId, async () => {
      const record = await findCallLink(params.callId);
      if (!record) {
        return sendError(reply, 404, "call_link_not_found", "Call link not found");
      }
      if (record.status === "ended" || Date.now() > Date.parse(record.expiresAt)) {
        return sendError(reply, 410, "call_link_expired", "Call link expired");
      }
      const parsed = await parseCallRoomEventRequest(request.body, record);
      if (!parsed.ok) {
        const status = parsed.code === "call_link_binding_conflict" ? 409 : 400;
        return sendError(reply, status, parsed.code, parsed.message);
      }
      let result;
      try {
        result = await publishCallRoomDataEvents(record, parsed.events, {
          expectedVersion: parsed.expectedVersion,
        });
      } catch (error) {
        if (error instanceof SessionVersionConflictError) {
          return versionConflict(reply, error);
        }
        if (
          error instanceof InboxPayloadConflictError ||
          error instanceof StorageConflictError ||
          error instanceof CallPlaybackConflictError
        ) {
          return sendError(
            reply,
            409,
            "call_event_conflict",
            "Call event conflicts with persisted state",
          );
        }
        throw error;
      }
      if (!result.ok) {
        return sendError(
          reply,
          503,
          "call_room_provider_not_configured",
          "Call room provider not configured",
        );
      }
      if (
        parsed.events.some(
          (event) =>
            event.type === "worker.status" &&
            event.segmentId === "worker-started",
        )
      ) {
        getCallLinkWorkerSupervisor().markReady(record.callId);
      }
      return {
        callId: record.callId,
        sessionId: record.sessionId,
        roomName: result.roomName,
        topic: result.topic,
        publishedEvents: result.events.map((event) => event.type),
        playbackBindings: playbackBindings(result.events),
        duplicateCount: result.duplicateCount,
        sessionVersion: result.sessionVersion,
      };
    });
  });
  app.post(
    "/internal/call-links/:callId/worker-room-token",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const params = request.params as { callId: string };
      return withSessionWriteLock(params.callId, async () => {
        const record = await findCallLink(params.callId);
        if (!record) {
          return sendError(reply, 404, "call_link_not_found", "Call link not found");
        }
        if (record.status === "ended" || Date.now() > Date.parse(record.expiresAt)) {
          return sendError(reply, 410, "call_link_expired", "Call link expired");
        }
        if (!matchesOptionalCallBinding(request.body, record)) {
          return bindingConflict(reply);
        }
        const body = (request.body ?? {}) as Partial<{ participantName: string }>;
        const token = await createCallRoomToken({
          callId: record.callId,
          roomName: record.roomName,
          participantRole: "worker",
          participantName: body.participantName ?? "translation-worker",
          fullDuplexEnabled: loadEnv().callFullDuplexEnabled,
        });
        if (!token.ok) {
          return sendError(
            reply,
            503,
            "call_room_provider_not_configured",
            "Call room provider not configured",
          );
        }
        await registerCallLeg({
          callId: record.callId,
          participantIdentity: token.participantIdentity,
          participantRole: "worker",
          joinType: "worker",
        });
        const ttsVoice = getReadyVoiceProfileTtsConfig(record.userId);
        return {
          ...token,
          sessionId: record.sessionId,
          ...(ttsVoice ? { ttsVoice } : {}),
        };
      });
    },
  );

  app.post("/internal/call-links/:callId/sip-status", async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(reply, 401, "internal_error", "Unauthorized internal request");
    }
    const params = request.params as { callId: string };
    const status = parseSipStatus(request.body);
    if (!status) {
      return sendError(
        reply,
        400,
        "invalid_sip_status",
        "Invalid LiveKit SIP participant status",
      );
    }
    return withSessionWriteLock(params.callId, async () => {
      const record = await findCallLink(params.callId);
      if (!record) {
        return sendError(reply, 404, "call_link_not_found", "Call link not found");
      }
      const operation = findProviderOperation(status.operationId);
      const expectedIdentity = liveKitSipParticipantIdentity(
        record.sessionId,
        status.operationId,
      );
      const inbound = operation?.operationType === "sip_inbound";
      if (!operation || operation.sessionId !== record.sessionId ||
        operation.provider !== "livekit_sip" ||
        (operation.operationType !== "sip_outbound" && !inbound) ||
        (!inbound && status.participantIdentity !== expectedIdentity)) {
        return bindingConflict(reply);
      }
      const observedAt = new Date();
      const result = await (status.callStatus === "active" ||
          status.callStatus === "automation"
        ? markLiveKitSipAnswered({
          operationId: operation.id,
          participantIdentity: status.participantIdentity,
          observedAt,
          externalOperationId: status.sipCallId,
          externalResourceId: inbound ? undefined : status.participantSid,
        })
        : status.callStatus === "hangup"
        ? observeLiveKitSipCompletion({
          operationId: operation.id,
          event: "participant_left",
          observedAt,
          externalOperationId: status.sipCallId,
          externalResourceId: inbound ? undefined : status.participantSid,
        })
        : observeLiveKitSipDialing(operation.id, status, observedAt));
      if (result.terminal) {
        if (inbound) await closeLiveKitSipInbound(operation, "worker_terminal");
        await getCallLinkWorkerSupervisor().stop(record.callId);
        await deliverPendingCallRoomDataEvents(record);
      }
      if ((status.callStatus === "active" || status.callStatus === "automation") &&
        result.status !== "active") {
        return sendError(reply, 409, "sip_status_not_active",
          "SIP operation is no longer active");
      }
      return {
        callId: record.callId,
        operationId: operation.id,
        callStatus: status.callStatus,
        status: result.status,
      };
    });
  });
}
type SipStatus = {
  operationId: string;
  participantIdentity: string;
  participantSid?: string;
  sipCallId?: string;
  callStatus: "dialing" | "active" | "automation" | "hangup";
};
function parseSipStatus(body: unknown): SipStatus | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (!boundedString(value.operationId, 96) ||
    !boundedString(value.participantIdentity, 256) ||
    !["dialing", "active", "automation", "hangup"].includes(
      String(value.callStatus),
    ) || !optionalBoundedString(value.participantSid, 128) ||
    !optionalBoundedString(value.sipCallId, 256)) return null;
  return {
    operationId: value.operationId,
    participantIdentity: value.participantIdentity,
    callStatus: value.callStatus as SipStatus["callStatus"],
    ...(value.participantSid ? { participantSid: value.participantSid } : {}),
    ...(value.sipCallId ? { sipCallId: value.sipCallId } : {}),
  };
}
function observeLiveKitSipDialing(
  operationId: string,
  status: SipStatus,
  observedAt: Date,
) {
  const operation = findProviderOperation(operationId);
  if (!operation) return { status: "not_found" as const, terminal: false };
  const updated = updateProviderOperation({
    operationId,
    status: operation.status,
    externalOperationId: status.sipCallId,
    externalResourceId: status.participantSid,
    now: observedAt,
  });
  return {
    status: updated.status === "updated" ? "dialing" as const : updated.status,
    terminal: false,
  };
}
function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}
function optionalBoundedString(
  value: unknown,
  maxLength: number,
): value is string | undefined {
  return value === undefined || boundedString(value, maxLength);
}

function playbackBindings(events: Array<{
  type: string;
  playbackId?: string;
  generation?: number;
  sourceLegId?: string;
  targetLegId?: string;
}>) {
  const bindings = new Map<string, {
    playbackId: string;
    generation: number;
    sourceLegId: string;
    targetLegId: string;
  }>();
  for (const event of events) {
    if (!event.type.startsWith("playback.") || !event.playbackId ||
      !event.generation || !event.sourceLegId || !event.targetLegId) continue;
    bindings.set(`${event.playbackId}:${event.generation}`, {
      playbackId: event.playbackId,
      generation: event.generation,
      sourceLegId: event.sourceLegId,
      targetLegId: event.targetLegId,
    });
  }
  return [...bindings.values()];
}

export function isInternalAuthorized(authorization: string | undefined) {
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  return authorization === `Bearer ${secret}`;
}
function versionConflict(
  reply: Parameters<typeof sendError>[0],
  error: SessionVersionConflictError,
) {
  return reply.status(409).send({
    error: {
      code: "session_version_conflict",
      message: "Session version changed; refresh and retry",
    },
    sessionId: error.sessionId,
    expectedVersion: error.expectedVersion,
    currentVersion: error.currentVersion,
  });
}
function matchesOptionalCallBinding(body: unknown, record: CallLinkRecord) {
  if (body === undefined || body === null) return true;
  if (typeof body !== "object") return false;
  const value = body as Record<string, unknown>;
  return matchesOptionalString(value.callId, record.callId) &&
    matchesOptionalString(value.sessionId, record.sessionId) &&
    matchesOptionalString(value.roomName, record.roomName);
}
function matchesOptionalString(value: unknown, expected: string) {
  return value === undefined || value === expected;
}

function bindingConflict(reply: Parameters<typeof sendError>[0]) {
  return sendError(
    reply,
    409,
    "call_link_binding_conflict",
    "Request binding does not match the requested call link",
  );
}
