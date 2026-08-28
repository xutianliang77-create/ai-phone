import type {
  VoiceClientOwnershipDto,
  VoiceClientTakeoverDto,
} from "@translation/contracts";

export type VoiceClientOwnershipRecord = VoiceClientOwnershipDto & {
  createdAt: string;
  releasedAt?: string;
  releaseReason?: string;
};

export type VoiceClientOwnershipRow = Record<string, unknown> & {
  session_id: string;
  leg_id: string;
};

export type VoiceClientTakeoverRow = Record<string, unknown> & {
  takeover_id: string;
};

export function voiceClientOwnershipFromRow(
  row: VoiceClientOwnershipRow,
): VoiceClientOwnershipRecord {
  const state = enumValue(row.state, ["active", "released"] as const, "state");
  return {
    sessionId: text(row.session_id, "session_id"),
    legId: text(row.leg_id, "leg_id"),
    accountId: text(row.account_id, "account_id"),
    clientInstanceId: text(row.client_instance_id, "client_instance_id"),
    participantIdentity:
      text(row.participant_identity, "participant_identity", 320),
    generation: integer(row.generation, "generation"),
    leaseId: text(row.lease_id, "lease_id"),
    leaseExpiresAt: timestamp(row.lease_expires_at, "lease_expires_at"),
    state,
    version: integer(row.version, "version"),
    createdAt: timestamp(row.created_at, "created_at"),
    updatedAt: timestamp(row.updated_at, "updated_at"),
    ...(row.released_at
      ? { releasedAt: timestamp(row.released_at, "released_at") }
      : {}),
    ...(row.release_reason
      ? { releaseReason: text(row.release_reason, "release_reason", 120) }
      : {}),
  };
}

export function voiceClientTakeoverFromRow(
  row: VoiceClientTakeoverRow,
): VoiceClientTakeoverDto {
  const status = enumValue(
    row.status,
    ["pending", "confirmed", "cancelled", "expired"] as const,
    "takeover_status",
  );
  return {
    takeoverId: text(row.takeover_id, "takeover_id"),
    sessionId: text(row.session_id, "session_id"),
    legId: text(row.leg_id, "leg_id"),
    accountId: text(row.account_id, "account_id"),
    requestedClientInstanceId:
      text(row.requested_client_instance_id, "requested_client_instance_id"),
    requestedParticipantIdentity: text(
      row.requested_participant_identity,
      "requested_participant_identity",
      320,
    ),
    expectedGeneration:
      integer(row.expected_generation, "expected_generation"),
    status,
    expiresAt: timestamp(row.expires_at, "expires_at"),
    createdAt: timestamp(row.created_at, "created_at"),
    ...(row.confirmed_at
      ? { confirmedAt: timestamp(row.confirmed_at, "confirmed_at") }
      : {}),
  };
}

export function assertActiveVoiceClientOwnership(
  ownership: VoiceClientOwnershipRecord,
  input: {
    accountId: string;
    clientInstanceId: string;
    participantIdentity: string;
    leaseId: string;
    generation: number;
    now: Date;
  },
) {
  if (ownership.state !== "active" ||
    Date.parse(ownership.leaseExpiresAt) <= input.now.getTime() ||
    ownership.accountId !== input.accountId ||
    ownership.clientInstanceId !== input.clientInstanceId ||
    ownership.participantIdentity !== input.participantIdentity ||
    ownership.leaseId !== input.leaseId ||
    ownership.generation !== input.generation) {
    throw new VoiceClientOwnershipConflict("voice_ownership_lease_invalid");
  }
}

export class VoiceClientOwnershipConflict extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "VoiceClientOwnershipConflict";
  }
}

function text(value: unknown, name: string, maximum = 160) {
  if (typeof value !== "string" || !value.trim() ||
      Buffer.byteLength(value) > maximum) {
    throw new VoiceClientOwnershipConflict(`voice_ownership_${name}_invalid`);
  }
  return value.trim();
}

function integer(value: unknown, name: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new VoiceClientOwnershipConflict(`voice_ownership_${name}_invalid`);
  }
  return parsed;
}

function timestamp(value: unknown, name: string) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new VoiceClientOwnershipConflict(`voice_ownership_${name}_invalid`);
  }
  return date.toISOString();
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  name: string,
): Values[number] {
  if (typeof value !== "string" ||
      !(values as readonly string[]).includes(value)) {
    throw new VoiceClientOwnershipConflict(`voice_ownership_${name}_invalid`);
  }
  return value as Values[number];
}
