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
} from "../sessions/sessions.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { runStoreTransaction } from "../../infrastructure/storage/json-store.js";
import { registerCallLinkInternalRoutes } from "./call-link-internal.routes.js";

export async function registerCallLinkRoutes(app: FastifyInstance) {
  app.addHook("onClose", async () => {
    getCallLinkWorkerSupervisor().shutdown();
  });
  registerCallRoomEntryRoute(app);
  registerCallLinkInternalRoutes(app);

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
    const livePresence = await readCallRoomHumanPresence(record);
    return toPublicCallLink(
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
      });
    },
  );

  app.post("/call-links/:callId/end", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { callId: string };
    return withSessionWriteLock(params.callId, async () => {
      const record = findCallLink(params.callId);
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
      const session = runStoreTransaction(() => {
        const completed = completeSessionWithUsage(record.sessionId);
        if (completed?.endedAt) endCallLegs(completed.id, completed.endedAt);
        return completed;
      });
      if (!session)
        return sendError(reply, 404, "session_not_found", "Session not found");
      await deliverPendingCallRoomDataEvents(record);
      if (!wasEnded) getCallLinkWorkerSupervisor().stop(record.callId);
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

function toPublicCallLink(
  record: CallLinkRecord,
  presence = persistedCallRoomHumanPresence(record.callId),
) {
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
    createdAt: record.createdAt,
    ...presence,
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
