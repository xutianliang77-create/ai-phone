import type { FastifyReply } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { resolveVoiceAgentPhoneSnapshotBinding } from
  "./voice-agent-phone-snapshot-binding.js";
import { resolveVoiceAgentRuntimeBinding } from
  "./voice-agent-runtime-binding.js";

export async function agentWorkBinding(draftId: string, ticket: string) {
  const binding = await resolveVoiceAgentRuntimeBinding(draftId, ticket);
  if (!binding.ok) return binding;
  const phone = await resolveVoiceAgentPhoneSnapshotBinding({
    call: binding.call,
    providerOperationId: binding.draft.providerOperationId!,
  });
  if (!phone.ok) return { ok: false as const, code: phone.code };
  return {
    ...binding,
    legId: phone.binding.participantIdentity,
  };
}

export function invalidAgentWorkRequest(
  reply: FastifyReply,
  subject: string,
) {
  return sendError(reply, 400, "invalid_agent_work_request", `Invalid ${subject}`);
}

export function agentWorkBindingFailure(reply: FastifyReply, code: string) {
  return sendError(reply, 409, `agent_work_${code}`, "Agent Work binding failed");
}

export function handleAgentWorkError(reply: FastifyReply, error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "agent_work_failed";
  if (code.includes("disabled") || code.includes("requires_postgres") ||
    code.includes("keyring") || code.includes("key_id_missing") ||
    code.includes("active_key_missing")) {
    return sendError(reply, 503, code, "Agent Work is unavailable");
  }
  if (code.includes("invalid") || code.includes("too_large") ||
    code.includes("too_deep")) {
    return sendError(reply, 400, code, "Agent Work request is invalid");
  }
  return sendError(reply, 409, code, "Agent Work request conflicts");
}
