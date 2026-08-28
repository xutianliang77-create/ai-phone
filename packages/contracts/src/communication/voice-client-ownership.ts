export type VoiceClientOwnershipState = "active" | "released";

export interface VoiceClientOwnershipDto {
  sessionId: string;
  legId: string;
  accountId: string;
  clientInstanceId: string;
  participantIdentity: string;
  generation: number;
  leaseId: string;
  leaseExpiresAt: string;
  state: VoiceClientOwnershipState;
  version: number;
  updatedAt: string;
}

export interface VoiceClientOwnershipAcquireRequest {
  commandId: string;
  clientInstanceId: string;
  participantIdentity: string;
  leaseSeconds?: number;
}

export interface VoiceClientOwnershipRenewRequest {
  commandId: string;
  clientInstanceId: string;
  participantIdentity: string;
  leaseId: string;
  generation: number;
  leaseSeconds?: number;
}

export interface VoiceClientTakeoverRequest {
  commandId: string;
  takeoverId: string;
  clientInstanceId: string;
  participantIdentity: string;
  expectedGeneration: number;
}

export interface VoiceClientTakeoverConfirmRequest {
  commandId: string;
  takeoverId: string;
  clientInstanceId: string;
  participantIdentity: string;
  expectedGeneration: number;
  leaseSeconds?: number;
}

export interface VoiceClientOwnershipReleaseRequest {
  commandId: string;
  clientInstanceId: string;
  participantIdentity: string;
  leaseId: string;
  generation: number;
  reason: "client_disconnected" | "session_ending" | "user_released";
}

export interface VoiceClientTakeoverDto {
  takeoverId: string;
  sessionId: string;
  legId: string;
  accountId: string;
  requestedClientInstanceId: string;
  requestedParticipantIdentity: string;
  expectedGeneration: number;
  status: "pending" | "confirmed" | "cancelled" | "expired";
  expiresAt: string;
  createdAt: string;
  confirmedAt?: string;
}

export function parseVoiceClientOwnershipAcquireRequest(
  value: unknown,
): VoiceClientOwnershipAcquireRequest {
  const input = object(value);
  return {
    commandId: text(input.commandId, "commandId", 200),
    clientInstanceId: text(input.clientInstanceId, "clientInstanceId"),
    participantIdentity:
      text(input.participantIdentity, "participantIdentity", 320),
    ...leaseSeconds(input.leaseSeconds),
  };
}

export function parseVoiceClientOwnershipRenewRequest(
  value: unknown,
): VoiceClientOwnershipRenewRequest {
  const input = object(value);
  return {
    ...parseVoiceClientOwnershipAcquireRequest(input),
    leaseId: text(input.leaseId, "leaseId"),
    generation: positiveInteger(input.generation, "generation"),
  };
}

export function parseVoiceClientTakeoverRequest(
  value: unknown,
): VoiceClientTakeoverRequest {
  const input = object(value);
  return {
    commandId: text(input.commandId, "commandId", 200),
    takeoverId: text(input.takeoverId, "takeoverId"),
    clientInstanceId: text(input.clientInstanceId, "clientInstanceId"),
    participantIdentity:
      text(input.participantIdentity, "participantIdentity", 320),
    expectedGeneration:
      positiveInteger(input.expectedGeneration, "expectedGeneration"),
  };
}

export function parseVoiceClientTakeoverConfirmRequest(
  value: unknown,
): VoiceClientTakeoverConfirmRequest {
  const input = object(value);
  return {
    ...parseVoiceClientTakeoverRequest(input),
    ...leaseSeconds(input.leaseSeconds),
  };
}

export function parseVoiceClientOwnershipReleaseRequest(
  value: unknown,
): VoiceClientOwnershipReleaseRequest {
  const input = object(value);
  const reason = input.reason;
  if (reason !== "client_disconnected" && reason !== "session_ending" &&
      reason !== "user_released") {
    throw new TypeError("Invalid voice ownership reason");
  }
  return {
    commandId: text(input.commandId, "commandId", 200),
    clientInstanceId: text(input.clientInstanceId, "clientInstanceId"),
    participantIdentity:
      text(input.participantIdentity, "participantIdentity", 320),
    leaseId: text(input.leaseId, "leaseId"),
    generation: positiveInteger(input.generation, "generation"),
    reason,
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid voice ownership request");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, maximum = 160) {
  if (typeof value !== "string" || !value.trim() ||
      Buffer.byteLength(value) > maximum) {
    throw new TypeError(`Invalid voice ownership ${name}`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, name: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`Invalid voice ownership ${name}`);
  }
  return Number(value);
}

function leaseSeconds(value: unknown) {
  if (value === undefined) return {};
  if (!Number.isSafeInteger(value) || Number(value) < 15 ||
      Number(value) > 120) {
    throw new TypeError("Invalid voice ownership leaseSeconds");
  }
  return { leaseSeconds: Number(value) };
}
