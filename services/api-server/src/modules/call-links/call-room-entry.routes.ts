import { publicTtsRuntimeReady, validateEntry, sendEntryError, sendGuestTicketError } from "./call-room-entry-route-helpers.js";
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
  removeCallRoomParticipant,
} from "./call-room-worker.js";
import { getCallLinkWorkerSupervisor } from "./call-link-worker-supervisor.js";
import { callLinkModelRuntimeAdmission } from "./call-link-model-runtime-policy.js";
import { admitCallRoomRole } from "./call-room-role-admission.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { loadEnv } from "../../config/env.js";
import { findSession } from "../sessions/sessions-runtime.repository.js";
import {
  inspectCallGuestTicket
} from "./call-guest-ticket.js";
import { consumeCallGuestTicket } from "./call-guest-ticket-runtime.js";
import {
  parseCallRoomParticipantName,
  parseCallRoomParticipantRole,
} from "./call-room-entry-validation.js";
import {
  type CallLinkPublicTtsCapability
} from "./call-link-public-tts.js";

export interface CallRoomEntryRouteOptions {
  publicTtsCapability?: CallLinkPublicTtsCapability;
}

export function registerCallRoomEntryRoute(
  app: FastifyInstance,
  options: CallRoomEntryRouteOptions = {},
) {
  app.post("/call-links/:callId/room-token", async (request, reply) => {
    const params = request.params as { callId: string };
    const body = (request.body ?? {}) as Partial<{
      guestTicket: string;
      participantName: string;
      participantRole: string;
      role: string;
    }>;
    const participantRole = parseCallRoomParticipantRole(
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
    const participantName = parseCallRoomParticipantName(body.participantName);
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

      const modelAdmission = await callLinkModelRuntimeAdmission(
        initial.record.sessionId,
      );
      if (!modelAdmission.ok) {
        return sendError(
          reply,
          503,
          modelAdmission.code,
          "Call room public model runtime is not ready",
        );
      }
      if (!await publicTtsRuntimeReady(
        initial.record.sessionId,
        options.publicTtsCapability,
      )) {
        return sendError(
          reply,
          503,
          "call_link_public_model_runtime_unavailable",
          "Call room public model runtime is not ready",
        );
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
    const participantRole = parseCallRoomParticipantRole(body.participantRole);
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
      if (!current.ok) return { kind: "validation" as const, result: current };
      const admission = await admitCallRoomRole({
        record: current.record,
        participantIdentity: body.participantIdentity!,
        participantRole,
      });
      if (admission.kind !== "admitted") {
        return { ...admission, record: current.record };
      }
      return {
        kind: "committed" as const,
        ...current,
        ready: admission.ready,
        workerPresent: admission.workerPresent,
      };
    });
    if (committed.kind === "validation") {
      return sendEntryError(reply, committed.result);
    }
    if (committed.kind === "presence_failed" ||
      committed.kind === "role_conflict") {
      const removed = await removeCallRoomParticipant(
        committed.record,
        body.participantIdentity,
      );
      if (!removed.ok) {
        request.log.error({
          callId: committed.record.callId,
          participantIdentity: body.participantIdentity,
          issues: removed.issues,
        }, "Rejected duplicate call participant could not be removed");
      }
      if (committed.kind === "presence_failed") {
        request.log.error({
          callId: committed.record.callId,
          issues: committed.issues,
        }, "Existing call participant verification failed");
        return sendError(
          reply,
          503,
          "call_room_participant_check_failed",
          "Call room participant could not be verified",
        );
      }
      return sendError(
        reply,
        409,
        "call_room_participant_role_in_use",
        "Another participant is already connected for this role",
      );
    }

    if (committed.ready && !committed.workerPresent) {
      const modelAdmission = await callLinkModelRuntimeAdmission(
        committed.record.sessionId,
      );
      if (!modelAdmission.ok) {
        return sendError(
          reply,
          503,
          modelAdmission.code,
          "Call room public model runtime is not ready",
        );
      }
      if (!await publicTtsRuntimeReady(
        committed.record.sessionId,
        options.publicTtsCapability,
      )) {
        return sendError(
          reply,
          503,
          "call_link_public_model_runtime_unavailable",
          "Call room public model runtime is not ready",
        );
      }
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
