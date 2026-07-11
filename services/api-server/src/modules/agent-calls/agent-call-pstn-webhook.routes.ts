import type { FastifyInstance } from "fastify";
import type { PstnAgentCallWebhookRequest } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { toAgentCallDto as toDto } from "./agent-call-route-helpers.js";
import { verifyPstnAgentCallWebhook } from "./agent-call-pstn-webhook.js";
import { updateAgentCallFromPstnWebhook } from "./agent-calls.repository.js";

export async function registerAgentCallPstnWebhookRoutes(app: FastifyInstance) {
  app.post("/webhooks/pstn/agent-calls", async (request, reply) => {
    const verified = verifyPstnAgentCallWebhook({
      body: request.body as PstnAgentCallWebhookRequest,
      signature: singleHeader(request.headers["x-translation-pstn-signature"]),
    });
    if (verified.status === "not_configured") {
      return sendError(
        reply,
        503,
        "pstn_webhook_not_configured",
        "PSTN webhook is not configured",
      );
    }
    if (verified.status === "invalid_body") {
      return sendError(
        reply,
        400,
        "invalid_pstn_webhook",
        "Invalid PSTN webhook payload",
      );
    }
    if (verified.status === "invalid_signature") {
      return sendError(
        reply,
        401,
        "invalid_pstn_webhook_signature",
        "Invalid PSTN webhook signature",
      );
    }
    const result = updateAgentCallFromPstnWebhook(verified.body);
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
    return { status: result.status, draft: toDto(result.draft) };
  });
}

function singleHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
