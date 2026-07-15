import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { toSessionDetail } from "./session-mappers.js";
import {
  findSession,
  updateSessionReviewActionItem,
} from "./sessions.repository.js";
import { withSessionWriteLock } from "./session-write-coordinator.js";

export function registerSessionReviewActionRoutes(app: FastifyInstance) {
  app.patch(
    "/sessions/:sessionId/action-items/:actionIndex",
    async (request, reply) => {
      const account = requireAccount(request, reply);
      if (!account) return;
      const params = request.params as {
        sessionId: string;
        actionIndex: string;
      };
      const body = request.body as { completed?: unknown };
      const actionIndex = Number(params.actionIndex);
      if (!Number.isInteger(actionIndex) || actionIndex < 0 ||
          typeof body.completed !== "boolean") {
        return sendError(
          reply,
          400,
          "invalid_action_item_update",
          "actionIndex and completed are required",
        );
      }
      const completed = body.completed;
      return withSessionWriteLock(params.sessionId, () => {
        const session = findSession(params.sessionId);
        if (!session) {
          return sendError(reply, 404, "session_not_found", "Session not found");
        }
        if (session.userId !== account.id) {
          return sendError(
            reply,
            403,
            "account_forbidden",
            "Account cannot access this resource",
          );
        }
        if (!session.review?.actionItems?.[actionIndex]) {
          return sendError(
            reply,
            404,
            "action_item_not_found",
            "Action item not found",
          );
        }
        const updated = updateSessionReviewActionItem(
          params.sessionId,
          actionIndex,
          completed,
        );
        return toSessionDetail(updated ?? session);
      });
    },
  );
}
