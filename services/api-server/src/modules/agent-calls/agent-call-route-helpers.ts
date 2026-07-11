import type { AgentCallRecord } from "./agent-call-record.js";

export function toAgentCallDto(record: AgentCallRecord) {
  const {
    userId: _userId,
    providerWebhookEventIds: _eventIds,
    ...draft
  } = record;
  return draft;
}

export function isStarted(status: string) {
  return (
    status === "queued" ||
    status === "in_progress" ||
    status === "completed" ||
    status === "failed"
  );
}

export function isInternalAuthorized(authorization: string | undefined) {
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  return authorization === `Bearer ${secret}`;
}
