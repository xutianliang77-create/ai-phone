import type { FastifyInstance } from "fastify";
import { loadEnv } from "../../config/env.js";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { verifyDiagnosticsAdmin } from "../diagnostics/diagnostics-auth.js";
import {
  readLiveKitClientBundle,
  renderCallGuestPage,
} from "./call-web-assets.js";
import { renderCallGuestScript } from "./call-web-guest-script.js";
import {
  type CallLinkRecord,
  createCallLink,
  findCallLink,
  markCallLinkEnded,
} from "./call-links.service.js";
import { completeSessionWithUsage } from "../sessions/session-completion.js";
import { getReadyVoiceProfileTtsConfig } from "../voice-profiles/voice-profiles.service.js";
import {
  type CallRoomParticipantRole,
  createCallRoomToken,
} from "./call-room-token.js";
import {
  publishCallRoomDataEvents,
  publishCallRoomSmokeCaptions,
} from "./call-room-worker.js";
import { parseCallRoomEventRequest } from "./call-room-event-request.js";

export async function registerCallLinkRoutes(app: FastifyInstance) {
  app.get("/join/:callId", async (request, reply) => {
    const params = request.params as { callId: string };
    return reply
      .type("text/html; charset=utf-8")
      .send(renderCallGuestPage(params.callId));
  });

  app.get("/call-web/livekit-client.umd.js", async (_request, reply) => {
    return reply
      .type("application/javascript; charset=utf-8")
      .send(await readLiveKitClientBundle());
  });

  app.get("/call-web/guest.js", async (_request, reply) => {
    return reply
      .type("application/javascript; charset=utf-8")
      .send(renderCallGuestScript());
  });

  app.post("/call-links", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const env = loadEnv();
    const callLink = createCallLink({
      userId: account.id,
      publicBaseUrl: env.publicCallBaseUrl,
    });
    if (!callLink) {
      return sendError(
        reply,
        402,
        "call_link_insufficient_balance",
        "Call link requires remaining usage balance",
      );
    }
    return toPublicCallLink(callLink);
  });

  app.get("/call-links/:callId", async (request, reply) => {
    const params = request.params as { callId: string };
    const record = findCallLink(params.callId);
    if (!record)
      return sendError(
        reply,
        404,
        "call_link_not_found",
        "Call link not found",
      );
    return toPublicCallLink(record);
  });

  app.post("/call-links/:callId/room-token", async (request, reply) => {
    const params = request.params as { callId: string };
    const record = findCallLink(params.callId);
    if (!record)
      return sendError(
        reply,
        404,
        "call_link_not_found",
        "Call link not found",
      );
    if (Date.now() > Date.parse(record.expiresAt)) {
      return sendError(reply, 410, "call_link_expired", "Call link expired");
    }
    const body = (request.body ?? {}) as Partial<{
      participantName: string;
      participantRole: string;
      role: string;
    }>;
    const participantRole = parseParticipantRole(
      body.participantRole ?? body.role,
    );
    if (!participantRole) {
      return sendError(
        reply,
        400,
        "invalid_call_room_participant",
        "Invalid participant role",
      );
    }
    if (participantRole === "host") {
      const account = requireAccount(request, reply);
      if (!account) return;
      if (record.userId !== account.id) return forbidden(reply);
    }
    const token = createCallRoomToken({
      callId: record.callId,
      roomName: record.roomName,
      participantRole,
      participantName: body.participantName,
    });
    if (!token.ok) {
      return sendError(
        reply,
        503,
        "call_room_provider_not_configured",
        "Call room provider not configured",
      );
    }
    return token;
  });

  app.post(
    "/call-links/:callId/worker-smoke-caption",
    async (request, reply) => {
      const auth = verifyDiagnosticsAdmin(request.headers.authorization);
      if (!auth.ok) {
        return sendError(reply, auth.statusCode, auth.code, auth.message);
      }
      const params = request.params as { callId: string };
      const record = findCallLink(params.callId);
      if (!record)
        return sendError(
          reply,
          404,
          "call_link_not_found",
          "Call link not found",
        );
      if (Date.now() > Date.parse(record.expiresAt)) {
        return sendError(reply, 410, "call_link_expired", "Call link expired");
      }
      const result = await publishCallRoomSmokeCaptions(record);
      if (!result.ok) {
        return sendError(
          reply,
          503,
          "call_room_provider_not_configured",
          "Call room provider not configured",
        );
      }
      return {
        callId: record.callId,
        sessionId: record.sessionId,
        roomName: result.roomName,
        topic: result.topic,
        publishedEvents: result.events.map((event) => event.type),
      };
    },
  );

  app.post("/call-links/:callId/end", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { callId: string };
    const record = findCallLink(params.callId);
    if (!record)
      return sendError(
        reply,
        404,
        "call_link_not_found",
        "Call link not found",
      );
    if (record.userId !== account.id) return forbidden(reply);

    const session = completeSessionWithUsage(record.sessionId);
    if (!session)
      return sendError(reply, 404, "session_not_found", "Session not found");
    markCallLinkEnded(record.callId, session.endedAt);
    return {
      callId: record.callId,
      sessionId: session.id,
      status: session.status,
      consumedSeconds: session.consumedSeconds,
      endedAt: session.endedAt,
    };
  });

  app.post("/internal/call-links/:callId/events", async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(
        reply,
        401,
        "internal_error",
        "Unauthorized internal request",
      );
    }
    const params = request.params as { callId: string };
    const record = findCallLink(params.callId);
    if (!record)
      return sendError(
        reply,
        404,
        "call_link_not_found",
        "Call link not found",
      );
    if (Date.now() > Date.parse(record.expiresAt)) {
      return sendError(reply, 410, "call_link_expired", "Call link expired");
    }

    const parsed = parseCallRoomEventRequest(request.body, record);
    if (!parsed.ok) return sendError(reply, 400, parsed.code, parsed.message);
    const result = await publishCallRoomDataEvents(record, parsed.events);
    if (!result.ok) {
      return sendError(
        reply,
        503,
        "call_room_provider_not_configured",
        "Call room provider not configured",
      );
    }
    return {
      callId: record.callId,
      sessionId: record.sessionId,
      roomName: result.roomName,
      topic: result.topic,
      publishedEvents: result.events.map((event) => event.type),
    };
  });

  app.post(
    "/internal/call-links/:callId/worker-room-token",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(
          reply,
          401,
          "internal_error",
          "Unauthorized internal request",
        );
      }
      const params = request.params as { callId: string };
      const record = findCallLink(params.callId);
      if (!record)
        return sendError(
          reply,
          404,
          "call_link_not_found",
          "Call link not found",
        );
      if (Date.now() > Date.parse(record.expiresAt)) {
        return sendError(reply, 410, "call_link_expired", "Call link expired");
      }
      const body = (request.body ?? {}) as Partial<{ participantName: string }>;
      const token = createCallRoomToken({
        callId: record.callId,
        roomName: record.roomName,
        participantRole: "worker",
        participantName: body.participantName ?? "translation-worker",
      });
      if (!token.ok) {
        return sendError(
          reply,
          503,
          "call_room_provider_not_configured",
          "Call room provider not configured",
        );
      }
      const ttsVoice = getReadyVoiceProfileTtsConfig(record.userId);
      return {
        ...token,
        sessionId: record.sessionId,
        ...(ttsVoice ? { ttsVoice } : {}),
      };
    },
  );
}

function parseParticipantRole(value: unknown): CallRoomParticipantRole | null {
  if (value === undefined || value === "guest") return "guest";
  return value === "host" ? "host" : null;
}

function isInternalAuthorized(authorization: string | undefined) {
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  return authorization === `Bearer ${secret}`;
}

function toPublicCallLink(record: CallLinkRecord) {
  return {
    callId: record.callId,
    sessionId: record.sessionId,
    roomName: record.roomName,
    roomProvider: record.roomProvider,
    joinUrl: record.joinUrl,
    hostUrl: record.hostUrl,
    status: record.status,
    mode: record.mode,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    ...(record.endedAt ? { endedAt: record.endedAt } : {}),
  };
}

function forbidden(reply: Parameters<typeof sendError>[0]) {
  return sendError(
    reply,
    403,
    "account_forbidden",
    "Account cannot access this resource",
  );
}
