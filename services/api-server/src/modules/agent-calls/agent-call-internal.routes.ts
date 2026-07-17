import type { FastifyInstance } from "fastify";
import type { UpdateAiCallingAgentCallStatusRequest } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  isInternalAuthorized,
  toAgentCallDto as toDto,
} from "./agent-call-route-helpers.js";
import {
  claimQueuedAgentCalls,
  updateClaimedAgentCall,
} from "./agent-call-lease.repository.js";

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
      const workerId = headerValue(request.headers["x-agent-worker-id"]);
      const leaseToken = headerValue(request.headers["x-agent-call-lease-token"]);
      if (!validWorkerId(workerId) || !leaseToken) {
        return sendError(reply, 400, "agent_call_lease_required", "Worker lease is required");
      }
      const result = updateClaimedAgentCall({
        draftId: (request.params as { draftId: string }).draftId,
        workerId,
        leaseToken,
        request: request.body as UpdateAiCallingAgentCallStatusRequest,
      });
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
      if (result.status === "lease_conflict") {
        return sendError(reply, 409, "agent_call_lease_conflict", "Worker lease is invalid");
      }
      return { draft: toDto(result.draft) };
    },
  );

  app.post(
    "/internal/ai-calling-agent/drafts/claims",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(
          reply,
          401,
          "internal_error",
          "Unauthorized internal request",
        );
      }
      const body = request.body as { workerId?: unknown; limit?: unknown } | undefined;
      const workerId = body?.workerId;
      const leaseSeconds = configuredLeaseSeconds();
      if (!validWorkerId(workerId)) {
        return sendError(reply, 400, "invalid_agent_worker_id", "Worker ID is invalid");
      }
      if (!leaseSeconds) {
        return sendError(reply, 503, "agent_call_lease_not_configured", "Lease is unavailable");
      }
      const result = claimQueuedAgentCalls({
        workerId,
        limit: Number(body?.limit ?? 5),
        leaseSeconds,
      });
      if (result.status === "not_configured") {
        return sendError(reply, 503, "agent_call_provider_not_configured", "Provider is unavailable");
      }
      return {
        claims: result.claims.map((claim) => ({
          ...claim,
          draft: toDto(claim.draft),
        })),
      };
    },
  );

  app.get("/internal/ai-calling-agent/drafts/queued", async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(reply, 401, "internal_error", "Unauthorized internal request");
    }
    return sendError(reply, 409, "agent_call_claim_required", "Use atomic worker claims");
  });
}

function validWorkerId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function configuredLeaseSeconds() {
  const value = Number(process.env.AGENT_CALL_WORKER_LEASE_SECONDS ?? 45);
  return Number.isInteger(value) && value >= 15 && value <= 300 ? value : null;
}
