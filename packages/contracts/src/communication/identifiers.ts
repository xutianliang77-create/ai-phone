export interface CommunicationIds {
  sessionId: string;
  speechId?: string;
  participantId?: string;
  roomId?: string;
  legId?: string;
  turnId?: string;
  segmentId?: string;
  playbackId?: string;
  workId?: string;
  deliveryAttemptId?: string;
  agentRunId?: string;
  providerOperationId?: string;
}

export function requireCommunicationId(
  name: keyof CommunicationIds,
  value: unknown,
) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 160) {
    throw new TypeError(`Invalid communication ${name}`);
  }
  return value.trim();
}
