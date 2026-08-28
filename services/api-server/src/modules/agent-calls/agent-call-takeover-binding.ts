import type { AgentCallRecord } from "./agent-call-record.js";

export function hasPersistedTakeoverBinding(
  draft: AgentCallRecord | null | undefined,
  participantIdentity: string,
) {
  return Boolean(
    draft?.takeoverResolvedAt &&
    draft.takeoverParticipantIdentity === participantIdentity,
  );
}
