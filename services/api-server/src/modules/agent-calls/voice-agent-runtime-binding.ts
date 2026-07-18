import { findCallLink } from "../call-links/call-links.service.js";
import { findWorkerDispatch } from
  "../worker-dispatches/worker-dispatch-runtime.repository.js";
import {
  findAgentCallDraftByCallReference,
  findAgentCallDraftById,
} from "./agent-calls-runtime.repository.js";
import { findActiveAgentRun } from "./agent-orchestration-runtime.repository.js";
import { getVoiceAgentRuntimeReadiness } from "./voice-agent-runtime-readiness.js";
import { getVoiceAgentRuntimeSupervisor } from "./voice-agent-runtime-supervisor.js";

export async function resolveVoiceAgentRuntimeBinding(
  draftId: string,
  ticket: string,
) {
  const runtime = getVoiceAgentRuntimeSupervisor();
  const claim = runtime.verifyTicket?.(ticket);
  const draft = await findAgentCallDraftById(draftId);
  const call = draft?.callId ? await findCallLink(draft.callId) : null;
  const run = draft ? await findActiveAgentRun(draft.id, "autonomous") : null;
  const readiness = getVoiceAgentRuntimeReadiness();
  if (!claim || !draft || !call || !run || !draft.disclosurePromptVersion ||
    !draft.providerOperationId ||
    readiness.status !== "ready") {
    return { ok: false as const, code: "binding_missing" };
  }
  if (call.purpose !== "voice_agent" || claim.callId !== call.callId ||
    claim.sessionId !== call.sessionId || claim.roomName !== call.roomName ||
    claim.agentName !== readiness.agentName) {
    return { ok: false as const, code: "binding_conflict" };
  }
  const dispatch = await findWorkerDispatch(call.sessionId);
  if (!dispatch || dispatch.generation !== claim.generation ||
    dispatch.agentName !== readiness.agentName) {
    return { ok: false as const, code: "generation_conflict" };
  }
  return { ok: true as const, runtime, claim, draft, call, run, dispatch };
}

export async function resolveVoiceAgentRuntimeCallBinding(
  callId: string,
  ticket: string,
) {
  const draft = await findAgentCallDraftByCallReference({ callId });
  return draft
    ? await resolveVoiceAgentRuntimeBinding(draft.id, ticket)
    : { ok: false as const, code: "binding_missing" };
}
