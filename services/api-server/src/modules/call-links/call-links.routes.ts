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
  persistedCallRoomHumanPresence,
  rotateCallLinkGuestTicket,
} from "./call-links.service.js";
import { completeSessionWithUsage } from "../sessions/session-completion.js";
import {
  deliverPendingCallRoomDataEvents,
  publishCallRoomSmokeCaptions,
  readCallRoomHumanPresence,
} from "./call-room-worker.js";
import { getCallLinkWorkerSupervisor } from "./call-link-worker-supervisor.js";
import { registerCallRoomEntryRoute } from "./call-room-entry.routes.js";
import {
  endCallLegs,
} from "../sessions/sessions-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { registerCallLinkInternalRoutes } from "./call-link-internal.routes.js";
import { getCallRoomResourceLimits } from "./call-room-resource-limits.js";
import { registerCallLinkSipRoutes } from "./call-link-sip.routes.js";
import { registerCallLinkSipControlRoutes } from "./call-link-sip-control.routes.js";
import { registerCallLinkSipInboundRoutes } from "./call-link-sip-inbound.routes.js";
import { registerLiveKitSipWebhookRoutes } from "./livekit-sip-webhook.routes.js";
import { registerCallLinkTtsTrackAccessRoutes } from "./call-link-tts-track-access.routes.js";
import { registerWorkerDispatchRuntimeRoutes } from "./worker-dispatch-runtime.routes.js";
import { registerRecordingRoutes } from "../recordings/recording.routes.js";

export async function registerCallLinkRoutes(app: FastifyInstance) {
  app.addHook("onClose", async () => {
    await getCallLinkWorkerSupervisor().shutdown();
  });
  registerCallRoomEntryRoute(app);
  registerCallLinkInternalRoutes(app);
  registerCallLinkSipRoutes(app);
  registerCallLinkSipControlRoutes(app);
  registerCallLinkSipInboundRoutes(app);
  registerLiveKitSipWebhookRoutes(app);
  registerCallLinkTtsTrackAccessRoutes(app);
  registerWorkerDispatchRuntimeRoutes(app);
  registerRecordingRoutes(app);

  app.get("/join/:callId", async (request, reply) => {
    const params = request.params as { callId: string };
    const record = await findCallLink(params.callId);
    if (!record || record.purpose !== "human_call") {
      return sendError(reply, 404, "call_link_not_found", "Call link not found");
    }
    return reply
      .header("cache-control", "no-store")
      .header("referrer-policy", "no-referrer")
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
    const limits = getCallRoomResourceLimits();
    const callLink = await createCallLink({
      userId: account.id,
      publicBaseUrl: env.publicCallBaseUrl,
      ttlSeconds: limits.maxSessionSeconds,
      guestTicketTtlSeconds: limits.guestTicketTtlSeconds,
    });
    if (!callLink) {
      return sendError(
        reply,
        402,
        "call_link_insufficient_balance",
        "Call link requires remaining usage balance",
      );
    }
    return reply.header("cache-control", "no-store").send(
      await toPublicCallLink(callLink),
    );
  });

  app.post("/call-links/:callId/guest-ticket", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { callId: string };
    return withSessionWriteLock(params.callId, async () => {
      const record = await findCallLink(params.callId);
      if (!record) {
        return sendError(reply, 404, "call_link_not_found", "Call link not found");
      }
      if (record.userId !== account.id) return forbidden(reply);
      if (record.purpose !== "human_call") {
        return sendError(reply, 404, "call_link_not_found", "Call link not found");
      }
      if (record.status === "ended" || Date.now() > Date.parse(record.expiresAt)) {
        return sendError(reply, 410, "call_link_expired", "Call link expired");
      }
      const issued = await rotateCallLinkGuestTicket({
        callId: record.callId,
        ttlSeconds: getCallRoomResourceLimits().guestTicketTtlSeconds,
      });
      if (!issued) {
        return sendError(
          reply,
          409,
          "guest_ticket_issue_conflict",
          "Guest ticket could not be issued",
        );
      }
      return reply.header("cache-control", "no-store").send(issued);
    });
  });

  app.get("/call-links/:callId", async (request, reply) => {
    const params = request.params as { callId: string };
    const record = await findCallLink(params.callId);
    if (!record || record.purpose !== "human_call")
      return sendError(
        reply,
        404,
        "call_link_not_found",
        "Call link not found",
      );
    const livePresence = await readCallRoomHumanPresence(record);
    return await toPublicCallLink(
      record,
      livePresence.ok ? livePresence.presence : undefined,
    );
  });

  app.post(
    "/call-links/:callId/worker-smoke-caption",
    async (request, reply) => {
      const auth = verifyDiagnosticsAdmin(request.headers.authorization);
      if (!auth.ok) {
        return sendError(reply, auth.statusCode, auth.code, auth.message);
      }
      const params = request.params as { callId: string };
      return withSessionWriteLock(params.callId, async () => {
        const record = await findCallLink(params.callId);
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
      });
    },
  );

  app.post("/call-links/:callId/end", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { callId: string };
    return withSessionWriteLock(params.callId, async () => {
      const record = await findCallLink(params.callId);
      if (!record)
        return sendError(
          reply,
          404,
          "call_link_not_found",
          "Call link not found",
        );
      if (record.userId !== account.id) return forbidden(reply);
      if (!matchesOptionalCallBinding(request.body, record)) {
        return bindingConflict(reply);
      }

      const wasEnded = record.status === "ended";
      const session = await completeSessionWithUsage(record.sessionId);
      if (session?.endedAt) await endCallLegs(session.id, session.endedAt);
      if (!session)
        return sendError(reply, 404, "session_not_found", "Session not found");
      await deliverPendingCallRoomDataEvents(record);
      if (!wasEnded) await getCallLinkWorkerSupervisor().stop(record.callId);
      return {
        callId: record.callId,
        sessionId: session.id,
        status: session.status,
        version: session.version ?? 1,
        consumedSeconds: session.consumedSeconds,
        endedAt: session.endedAt,
      };
    });
  });

}

async function toPublicCallLink(
  record: CallLinkRecord,
  presence?: Awaited<ReturnType<typeof persistedCallRoomHumanPresence>>,
) {
  const resolvedPresence = presence ??
    await persistedCallRoomHumanPresence(record.callId);
  return {
    callId: record.callId,
    sessionId: record.sessionId,
    roomName: record.roomName,
    roomProvider: record.roomProvider,
    joinUrl: record.joinUrl,
    hostUrl: record.hostUrl,
    status: record.status,
    version: record.version,
    mode: record.mode,
    expiresAt: record.expiresAt,
    guestTicketExpiresAt: record.guestTicketExpiresAt,
    createdAt: record.createdAt,
    ...resolvedPresence,
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
