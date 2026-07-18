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
import { findSession } from "../sessions/sessions-runtime.repository.js";
import {
  inspectCallGuestTicket,
  type GuestTicketFailure,
} from "./call-guest-ticket.js";
import { consumeCallGuestTicket } from "./call-guest-ticket-runtime.js";
import { getCallRoomResourceLimits } from "./call-room-resource-limits.js";

export function registerCallRoomEntryRoute(app: FastifyInstance) {
  app.post("/call-links/:callId/room-token", async (request, reply) => {
    const params = request.params as { callId: string };
    const body = (request.body ?? {}) as Partial<{
      guestTicket: string;
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
      ? await requireAccount(request, reply)
      : null;
    if (participantRole === "host" && !account) return;
    const participantName = parseParticipantName(body.participantName);
    if (!participantName.ok) {
      return sendError(
        reply,
        400,
        "invalid_call_room_participant_name",
        "Participant name exceeds the configured limit",
      );
    }

    return withSessionWriteLock(params.callId, async () => {
      const initial = await validateEntry(
        params.callId,
        participantRole,
        account?.id,
      );
      if (!initial.ok) return sendEntryError(reply, initial);
      if (participantRole === "guest") {
        const inspected = inspectCallGuestTicket({
          callId: initial.record.callId,
          sessionId: initial.record.sessionId,
          ticket: body.guestTicket ?? "",
          record: (await findSession(initial.record.sessionId))?.callLink?.guestTicket,
        });
        if (!inspected.ok) return sendGuestTicketError(reply, inspected.code);
      }

      const token = await createCallRoomToken({
        callId: initial.record.callId,
        roomName: initial.record.roomName,
        participantRole,
        participantName: participantName.value,
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
      if (participantRole === "guest") {
        const consumed = await consumeCallGuestTicket({
          callId: initial.record.callId,
          sessionId: initial.record.sessionId,
          ticket: body.guestTicket ?? "",
        });
        if (!consumed.ok) return sendGuestTicketError(reply, consumed.code);
      }
      return reply.header("cache-control", "no-store").send(token);
    });
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
      ? await requireAccount(request, reply)
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

    const committed = await withSessionWriteLock(params.callId, async () => {
      const current = await validateEntry(
        params.callId,
        participantRole,
        account?.id,
      );
      if (!current.ok) return current;
      await registerCallLeg({
        callId: current.record.callId,
        participantIdentity: body.participantIdentity!,
        participantRole,
        joinType: participantRole === "host" ? "app" : "web",
      });
      return {
        ...current,
        ready: await hasActiveHumanCallPair(current.record.callId),
        workerPresent: await hasActiveCallWorker(current.record.callId),
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

async function validateEntry(
  callId: string,
  participantRole: "host" | "guest",
  accountId?: string,
): Promise<EntryValidation> {
  const record = await findCallLink(callId);
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
  if (participantRole === "guest" && record.purpose === "voice_agent") {
    return {
      ok: false,
      status: 404,
      code: "call_link_not_found",
      message: "Call link not found",
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

function parseParticipantName(value: unknown):
  | { ok: true; value?: string }
  | { ok: false } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "string") return { ok: false };
  const normalized = value.trim();
  return Array.from(normalized).length <=
      getCallRoomResourceLimits().maxParticipantNameCharacters
    ? { ok: true, ...(normalized ? { value: normalized } : {}) }
    : { ok: false };
}

function sendGuestTicketError(
  reply: Parameters<typeof sendError>[0],
  code: GuestTicketFailure,
) {
  if (code === "guest_ticket_expired") {
    return sendError(reply, 410, code, "Guest ticket expired");
  }
  if (code === "guest_ticket_already_used") {
    return sendError(reply, 409, code, "Guest ticket was already used");
  }
  return sendError(reply, 403, code, "Guest ticket is invalid");
}
