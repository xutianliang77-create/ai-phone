import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { findCallLink } from "../call-links/call-links.service.js";
import { findAgentCallDraft } from "./agent-calls-runtime.repository.js";
import {
  pauseAgentCallDraft,
  resumePausedAgentCallDraft,
} from "./agent-call-pause-runtime.repository.js";
import { findAgentDialProviderOperation } from
  "./agent-call-provider-operation.js";
import { isAgentCallCarrierConnected } from
  "./agent-call-telephony-runtime.js";
import { toAgentCallReadDto } from "./agent-call-status-projection.js";
import { publishVoiceAgentControl } from "./voice-agent-control-publisher.js";

type AgentPauseAction = "pause" | "resume";

export function registerAgentCallPauseRoutes(app: FastifyInstance) {
  for (const action of ["pause", "resume"] as const) {
    app.post(
      `/ai-calling-agent/drafts/:draftId/${action}`,
      async (request, reply) => handleAgentPauseAction(request, reply, action),
    );
  }
}

async function handleAgentPauseAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: AgentPauseAction,
) {
  const account = await requireAccount(request, reply);
  if (!account) return;
  const draftId = (request.params as { draftId: string }).draftId;
  const current = await findAgentCallDraft(account.id, draftId);
  if (!current) {
    return sendError(reply, 404, "agent_call_draft_not_found", "Draft not found");
  }
  if (current.status !== "in_progress" || !current.callId ||
    !current.providerOperationId) {
    return sendError(
      reply,
      409,
      `agent_call_${action}_not_ready`,
      `Agent call is not ready to ${action}`,
    );
  }
  const call = await findCallLink(current.callId);
  const dial = call
    ? await findAgentDialProviderOperation(call.sessionId, current.providerOperationId)
    : null;
  if (!call || !dial || !await isAgentCallCarrierConnected(call, dial)) {
    return sendError(
      reply,
      409,
      `agent_call_${action}_not_ready`,
      "Carrier call is not connected",
    );
  }
  const result = action === "pause"
    ? await pauseAgentCallDraft(account.id, draftId)
    : await resumePausedAgentCallDraft(account.id, draftId);
  if (result.status === "mutation_conflict") {
    return sendError(
      reply,
      409,
      "agent_call_mutation_conflict",
      "Another draft operation is already in progress",
    );
  }
  if (result.status === "not_found") {
    return sendError(reply, 404, "agent_call_draft_not_found", "Draft not found");
  }
  if (result.status === "invalid_state") {
    return sendError(
      reply,
      409,
      `agent_call_${action}_not_ready`,
      `Agent call is not ready to ${action}`,
    );
  }
  const control = await publishVoiceAgentControl({
    callId: call.callId,
    command: action,
  });
  if (!control.ok) {
    request.log.warn(
      { callId: call.callId, action, code: control.code },
      "Voice Agent pause control will use heartbeat fallback",
    );
  }
  return {
    draft: await toAgentCallReadDto(result.draft),
    control: {
      state: action === "pause" ? "paused" : "running",
      delivery: control.ok ? "published" : "heartbeat_pending",
      replayed: result.status === "replayed",
    },
  };
}
