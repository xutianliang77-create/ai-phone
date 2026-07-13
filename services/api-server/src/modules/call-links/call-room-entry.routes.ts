import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { createCallRoomToken } from "./call-room-token.js";
import { ensureCallRoom } from "./call-room-worker.js";
import { getCallLinkWorkerSupervisor } from "./call-link-worker-supervisor.js";
import { findCallLink } from "./call-links.service.js";

export function registerCallRoomEntryRoute(app: FastifyInstance) {
  app.post("/call-links/:callId/room-token", async (request, reply) => {
    const params = request.params as { callId: string };
    const record = findCallLink(params.callId);
    if (!record) {
      return sendError(
        reply,
        404,
        "call_link_not_found",
        "Call link not found",
      );
    }
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
      if (record.userId !== account.id) {
        return sendError(
          reply,
          403,
          "account_forbidden",
          "Account cannot access this resource",
        );
      }
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
    const room = await ensureCallRoom(record);
    if (!room.ok) {
      request.log.error(
        { callId: record.callId, issues: room.issues },
        "Call room creation failed",
      );
      return sendError(
        reply,
        503,
        "call_room_start_failed",
        "Call room could not be created",
      );
    }
    try {
      await getCallLinkWorkerSupervisor().ensure(record.callId);
    } catch (error) {
      request.log.error(
        { callId: record.callId, err: error },
        "Call room Worker failed to join",
      );
      return sendError(
        reply,
        503,
        "call_room_worker_unavailable",
        "Call room translation worker could not join",
      );
    }
    return token;
  });
}

function parseParticipantRole(value: unknown) {
  if (value === undefined || value === "guest") return "guest" as const;
  return value === "host" ? ("host" as const) : null;
}
