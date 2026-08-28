import {
  parseAgentWorkCancelPayload,
  type ResolveVoiceAgentPermissionRequest,
  type VoiceAgentPermissionRequest,
  type VoiceAgentTurnEventRequest,
  type VoiceAgentWorkCancelRequest,
  type VoiceAgentWorkRequest,
} from "@translation/contracts";

export function parseVoiceTurnEventRequest(
  body: unknown,
): VoiceAgentTurnEventRequest | null {
  const value = object(body);
  if (!value || !text(value.ticket, 4096) || !text(value.eventId, 160) ||
    !["user_speaking", "final_transcript", "session_ending"]
      .includes(String(value.eventType)) ||
    !timestamp(value.observedAt) ||
    !optionalHash(value.explicitInstructionEvidenceHash)) return null;
  const hasEvidence = value.explicitInstructionEvidenceHash !== undefined;
  if ((value.eventType === "final_transcript") !== hasEvidence) return null;
  return {
    ticket: value.ticket,
    eventId: value.eventId,
    eventType: value.eventType as VoiceAgentTurnEventRequest["eventType"],
    observedAt: value.observedAt,
    ...(hasEvidence
      ? { explicitInstructionEvidenceHash:
          value.explicitInstructionEvidenceHash as string }
      : {}),
  };
}

export function parseVoiceAgentPermissionRequest(
  body: unknown,
): VoiceAgentPermissionRequest | null {
  const value = object(body);
  if (!value || !text(value.ticket, 4096) ||
    !text(value.permissionRequestId, 160) || !text(value.commandId, 200) ||
    !text(value.turnId, 160) || !integer(value.turnGeneration) ||
    !integer(value.dispatchGeneration) ||
    !hash(value.explicitInstructionEvidenceHash) ||
    !text(value.toolName, 120) || !text(value.toolVersion, 80) ||
    !text(value.submissionKey, 240) || !object(value.arguments) ||
    !hash(value.argumentsHash) ||
    !text(value.reasonCode, 120) || !timestamp(value.expiresAt)) return null;
  return value as unknown as VoiceAgentPermissionRequest;
}

export function parseVoiceAgentWorkRequest(
  body: unknown,
): VoiceAgentWorkRequest | null {
  const value = object(body);
  if (!value || !text(value.ticket, 4096) || !text(value.workId, 160) ||
    !text(value.commandId, 200) || !text(value.turnId, 160) ||
    !text(value.permissionRequestId, 160) ||
    !text(value.authorizationSnapshotId, 160)) return null;
  return value as unknown as VoiceAgentWorkRequest;
}

export function parseVoiceAgentWorkCancelRequest(
  body: unknown,
): VoiceAgentWorkCancelRequest | null {
  const value = object(body);
  if (!value || !text(value.ticket, 4096) || !text(value.commandId, 200)) {
    return null;
  }
  try {
    return {
      ticket: value.ticket,
      commandId: value.commandId,
      payload: parseAgentWorkCancelPayload(value.payload),
    };
  } catch {
    return null;
  }
}

export function parseVoiceAgentTicketRequest(body: unknown) {
  const value = object(body);
  return value && text(value.ticket, 4096) ? { ticket: value.ticket } : null;
}

export function parseResolveVoiceAgentPermissionRequest(
  body: unknown,
): ResolveVoiceAgentPermissionRequest | null {
  const value = object(body);
  if (!value || !["grant", "deny"].includes(String(value.decision)) ||
    !text(value.commandId, 200) || !text(value.clientInstanceId, 160) ||
    !text(value.participantIdentity, 320) ||
    !text(value.ownershipLeaseId, 160) ||
    !integer(value.ownershipGeneration) ||
    !timestamp(value.confirmedAt) || !integer(value.turnGeneration) ||
    !integer(value.dispatchGeneration)) return null;
  const age = Math.abs(Date.now() - Date.parse(value.confirmedAt as string));
  if (age > 5 * 60_000) return null;
  return value as unknown as ResolveVoiceAgentPermissionRequest;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function hash(value: unknown): value is string {
  return text(value, 64) && /^[0-9a-f]{64}$/.test(value);
}

function optionalHash(value: unknown) {
  return value === undefined || hash(value);
}

function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function timestamp(value: unknown): value is string {
  return text(value, 64) && Number.isFinite(Date.parse(value));
}
