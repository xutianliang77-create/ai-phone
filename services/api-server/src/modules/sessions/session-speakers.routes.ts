import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { toSessionDetail } from "./session-mappers.js";
import {
  findSession,
  listSessionSpeakers,
  renameSessionSpeaker,
} from "./sessions.repository.js";

export function registerSessionSpeakerRoutes(app: FastifyInstance) {
  app.get("/sessions/:sessionId/speakers", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { sessionId: string };
    const session = findSession(params.sessionId);
    if (!session)
      return sendError(reply, 404, "session_not_found", "Session not found");
    if (session.userId !== account.id) return forbidden(reply);
    return {
      sessionId: session.id,
      speakers: listSessionSpeakers(session.id) ?? [],
    };
  });

  app.patch(
    "/sessions/:sessionId/speakers/:speakerId",
    async (request, reply) => {
      const account = requireAccount(request, reply);
      if (!account) return;
      const params = request.params as { sessionId: string; speakerId: string };
      const session = findSession(params.sessionId);
      if (!session)
        return sendError(reply, 404, "session_not_found", "Session not found");
      if (session.userId !== account.id) return forbidden(reply);
      const body = request.body;
      const displayName = body && typeof body === "object" &&
        "displayName" in body && typeof body.displayName === "string"
        ? body.displayName.trim()
        : "";
      if (!displayName || displayName.length > 40) {
        return sendError(
          reply,
          400,
          "invalid_speaker_name",
          "displayName must contain 1 to 40 characters",
        );
      }
      const updated = renameSessionSpeaker(
        session.id,
        params.speakerId,
        displayName,
      );
      if (!updated) {
        return sendError(reply, 404, "speaker_not_found", "Speaker not found");
      }
      return toSessionDetail(updated);
    },
  );
}

function forbidden(reply: Parameters<typeof sendError>[0]) {
  return sendError(
    reply,
    403,
    "account_forbidden",
    "Account cannot access this resource",
  );
}
