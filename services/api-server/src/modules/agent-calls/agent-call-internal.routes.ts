import type { FastifyInstance } from "fastify";
import type { UpdateAiCallingAgentCallStatusRequest } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  isInternalAuthorized,
  toAgentCallDto as toDto,
} from "./agent-call-route-helpers.js";
import {
  listQueuedAgentCallDraftsForWorker,
  updateAgentCallExecutionStatusById,
} from "./agent-calls.repository.js";

export async function registerAgentCallInternalRoutes(app: FastifyInstance) {
  app.post(
    "/internal/ai-calling-agent/drafts/:draftId/status",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(
          reply,
          401,
          "internal_error",
          "Unauthorized internal request",
        );
      }
      const result = updateAgentCallExecutionStatusById(
        (request.params as { draftId: string }).draftId,
        request.body as UpdateAiCallingAgentCallStatusRequest,
      );
      if (result.status === "not_found") {
        return sendError(
          reply,
          404,
          "agent_call_draft_not_found",
          "Draft not found",
        );
      }
      if (result.status === "invalid") {
        return sendError(
          reply,
          400,
          "invalid_agent_call_status",
          "Invalid agent call status",
        );
      }
      if (result.status === "invalid_state") {
        return reply.status(409).send({
          error: {
            code: "agent_call_invalid_state",
            message: "Draft cannot be updated",
          },
          draft: toDto(result.draft),
        });
      }
      return { draft: toDto(result.draft) };
    },
  );

  app.get(
    "/internal/ai-calling-agent/drafts/queued",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(
          reply,
          401,
          "internal_error",
          "Unauthorized internal request",
        );
      }
      const limit = Number((request.query as { limit?: string }).limit ?? 10);
      return {
        drafts: listQueuedAgentCallDraftsForWorker(
          Number.isFinite(limit) ? limit : 10,
        ).map(toDto),
      };
    },
  );
}
