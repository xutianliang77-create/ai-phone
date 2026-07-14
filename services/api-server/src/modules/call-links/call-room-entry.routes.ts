import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  createCallRoomToken,
  verifyCallRoomConnectionToken,
} from "./call-room-token.js";
import {
  confirmCallRoomParticipant,
  ensureCallRoom,
} from "./call-room-worker.js";
import { getCallLinkWorkerSupervisor } from "./call-link-worker-supervisor.js";
import {
  type CallLinkRecord,
  hasActiveCallWorker,
  findCallLink,
  hasActiveHumanCallPair,
  registerCallLeg,
} from "./call-links.service.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { loadEnv } from "../../config/env.js";

export function registerCallRoomEntryRoute(app: FastifyInstance) {
  app.post("/call-links/:callId/room-token", async (request, reply) => {
    const params = request.params as { callId: string };
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
    const account = participantRole === "host"
      ? requireAccount(request, reply)
      : null;
    if (participantRole === "host" && !account) return;

    const initial = await withSessionWriteLock(params.callId, () =>
      validateEntry(params.callId, participantRole, account?.id));
    if (!initial.ok) return sendEntryError(reply, initial);

    const token = createCallRoomToken({
      callId: initial.record.callId,
      roomName: initial.record.roomName,
      participantRole,
      participantName: body.participantName,
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

    const room = await ensureCallRoom(initial.record);
    if (!room.ok) {
      request.log.error(
        { callId: initial.record.callId, issues: room.issues },
        "Call room creation failed",
      );
      return sendError(
        reply,
        503,
        "call_room_start_failed",
        "Call room could not be created",
      );
    }
    return token;
  });

  app.post("/call-links/:callId/room-connected", async (request, reply) => {
    const params = request.params as { callId: string };
    const body = (request.body ?? {}) as Partial<{
      participantIdentity: string;
      participantRole: string;
      token: string;
    }>;
    const participantRole = parseParticipantRole(body.participantRole);
    if (!participantRole || !body.participantIdentity || !body.token) {
      return sendError(
        reply,
        400,
        "invalid_call_room_confirmation",
        "Invalid call room connection confirmation",
      );
    }
    const account = participantRole === "host"
      ? requireAccount(request, reply)
      : null;
    if (participantRole === "host" && !account) return;

    const initial = await withSessionWriteLock(params.callId, () =>
      validateEntry(params.callId, participantRole, account?.id));
    if (!initial.ok) return sendEntryError(reply, initial);
    const tokenValid = await verifyCallRoomConnectionToken({
      token: body.token,
      callId: initial.record.callId,
      roomName: initial.record.roomName,
      participantIdentity: body.participantIdentity,
      participantRole,
    });
    if (!tokenValid) {
      return sendError(
        reply,
        403,
        "invalid_call_room_token",
        "Call room token does not match this participant",
      );
    }
    const participant = await confirmCallRoomParticipant(
      initial.record,
      body.participantIdentity,
    );
    if (!participant.ok) {
      request.log.error(
        { callId: initial.record.callId, issues: participant.issues },
        "Call room participant verification failed",
      );
      return sendError(
        reply,
        503,
        "call_room_participant_check_failed",
        "Call room participant could not be verified",
      );
    }
    if (!participant.connected) {
      return sendError(
        reply,
        409,
        "call_room_participant_not_connected",
        "Participant has not connected to the call room",
      );
    }

    const committed = await withSessionWriteLock(params.callId, () => {
      const current = validateEntry(params.callId, participantRole, account?.id);
      if (!current.ok) return current;
      registerCallLeg({
        callId: current.record.callId,
        participantIdentity: body.participantIdentity!,
        participantRole,
        joinType: participantRole === "host" ? "app" : "web",
      });
      return {
        ...current,
        ready: hasActiveHumanCallPair(current.record.callId),
        workerPresent: hasActiveCallWorker(current.record.callId),
      };
    });
    if (!committed.ok) return sendEntryError(reply, committed);

    if (committed.ready && !committed.workerPresent) {
      try {
        // Worker startup requests its own room token and writes this session.
        // Keep it outside the callId write lock to avoid lock inversion.
        await getCallLinkWorkerSupervisor().ensure(committed.record.callId);
      } catch (error) {
        request.log.error(
          { callId: committed.record.callId, err: error },
          "Call room Worker failed to join",
        );
        return sendError(
          reply,
          503,
          "call_room_worker_unavailable",
          "Call room translation worker could not join",
        );
      }
    }

    return {
      callId: committed.record.callId,
      roomName: committed.record.roomName,
      participantIdentity: body.participantIdentity,
      participantRole,
      status: committed.ready ? "active" : "waiting",
      workerReady: committed.ready,
    };
  });
}

type EntryValidation =
  | { ok: true; record: CallLinkRecord }
  | {
    ok: false;
    status: 403 | 404 | 410;
    code: "account_forbidden" | "call_link_not_found" | "call_link_expired";
    message: string;
  };

function validateEntry(
  callId: string,
  participantRole: "host" | "guest",
  accountId?: string,
): EntryValidation {
  const record = findCallLink(callId);
  if (!record) {
    return {
      ok: false,
      status: 404,
      code: "call_link_not_found",
      message: "Call link not found",
    };
  }
  if (record.status === "ended" || Date.now() > Date.parse(record.expiresAt)) {
    return {
      ok: false,
      status: 410,
      code: "call_link_expired",
      message: "Call link expired",
    };
  }
  if (participantRole === "host" && record.userId !== accountId) {
    return {
      ok: false,
      status: 403,
      code: "account_forbidden",
      message: "Account cannot access this resource",
    };
  }
  return { ok: true, record };
}

function sendEntryError(
  reply: Parameters<typeof sendError>[0],
  result: Exclude<EntryValidation, { ok: true }>,
) {
  return sendError(reply, result.status, result.code, result.message);
}

function parseParticipantRole(value: unknown) {
  if (value === undefined || value === "guest") return "guest" as const;
  return value === "host" ? ("host" as const) : null;
}
