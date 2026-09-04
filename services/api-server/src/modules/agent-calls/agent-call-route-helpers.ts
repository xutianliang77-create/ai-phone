import type { AgentCallRecord } from "./agent-call-record.js";

export function toAgentCallDto(record: AgentCallRecord) {
  const {
    userId: _userId,
    providerWebhookEventIds: _eventIds,
    workerLeaseOwner: _leaseOwner,
    workerLeaseTokenHash: _leaseTokenHash,
    workerLeaseExpiresAt: _leaseExpiresAt,
    workerLeaseAttempt: _leaseAttempt,
    providerOperationId: _providerOperationId,
    takeoverParticipantIdentity: _takeoverParticipantIdentity,
    ...draft
  } = record;
  return draft;
}

export function isStarted(status: string) {
  return (
    status === "queued" ||
    status === "dispatching" ||
    status === "reconciliation_required" ||
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
