import { createHash } from "node:crypto";
import type {
  AgentDeliveryAttemptRecord,
  AgentDeliveryServerPlaybackState,
  AgentDeliveryStatus,
} from "./agent-delivery-ledger.js";
import {
  boundedWorkInteger,
  boundedWorkValue,
  validWorkDate,
} from "./postgres-agent-work-support.js";

export interface AgentDeliveryRecord extends AgentDeliveryAttemptRecord {
  accountId: string;
  deliveryAttemptNumber: number;
  announcementHash: string;
  availableAt: string;
  claimAttempt: number;
}

export type AgentDeliveryRow = Record<string, unknown> & {
  delivery_attempt_id: string;
};

const statuses = [
  "generated",
  "claimed",
  "queued_for_playback",
  "playback_started",
  "playback_ended",
  "cancelled",
  "failed",
  "expired",
] as const satisfies readonly AgentDeliveryStatus[];

const serverStates = [
  "none",
  "queued",
  "started",
  "ended",
  "interrupted",
  "failed",
] as const satisfies readonly AgentDeliveryServerPlaybackState[];

export function agentDeliveryFromRow(
  row: AgentDeliveryRow,
): AgentDeliveryRecord {
  const playbackId = optionalText(row.playback_id, "playback_id", 160);
  const playbackGeneration = optionalInteger(
    row.playback_generation,
    "playback_generation",
  );
  const workerParticipantIdentity = optionalText(
    row.worker_participant_identity,
    "worker_participant_identity",
    320,
  );
  if (new Set([
    Boolean(playbackId),
    Boolean(playbackGeneration),
    Boolean(workerParticipantIdentity),
  ]).size !== 1) {
    throw new AgentDeliveryRecordError("delivery_playback_binding_invalid");
  }
  const claimId = optionalText(row.claim_id, "claim_id", 200);
  const claimantId = optionalText(row.claim_owner, "claim_owner", 200);
  const claimExpiresAt = optionalTimestamp(
    row.claim_expires_at,
    "claim_expires_at",
  );
  if ([claimId, claimantId, claimExpiresAt].filter(Boolean).length !== 0 &&
      [claimId, claimantId, claimExpiresAt].filter(Boolean).length !== 3) {
    throw new AgentDeliveryRecordError("delivery_claim_binding_invalid");
  }
  return {
    deliveryAttemptId:
      boundedWorkValue(row.delivery_attempt_id, "delivery_attempt_id", 160),
    workId: required(row.work_id, "work_id"),
    deliveryAttemptNumber:
      integer(row.delivery_attempt_number, "delivery_attempt_number", 1, 3),
    sessionId: required(row.session_id, "session_id"),
    legId: required(row.leg_id, "leg_id"),
    turnId: required(row.turn_id, "turn_id"),
    turnGeneration: integer(row.turn_generation, "turn_generation"),
    dispatchGeneration:
      integer(row.dispatch_generation, "dispatch_generation"),
    accountId: required(row.account_id, "account_id"),
    clientInstanceId: required(row.client_instance_id, "client_instance_id"),
    clientParticipantIdentity: boundedWorkValue(
      String(row.client_participant_identity),
      "client_participant_identity",
      320,
    ),
    ownershipLeaseId: required(row.ownership_lease_id, "ownership_lease_id"),
    ownershipGeneration:
      integer(row.ownership_generation, "ownership_generation"),
    announcementHash: hash(row.announcement_hash, "announcement_hash"),
    ...(playbackId && playbackGeneration && workerParticipantIdentity
      ? { playbackId, playbackGeneration, workerParticipantIdentity }
      : {}),
    status: enumValue(row.status, statuses, "status"),
    serverPlaybackState:
      enumValue(row.server_playback_state, serverStates, "server_state"),
    availableAt: timestamp(row.available_at, "available_at"),
    expiresAt: timestamp(row.expires_at, "expires_at"),
    attempt: integer(row.claim_attempt, "claim_attempt", 0),
    claimAttempt: integer(row.claim_attempt, "claim_attempt", 0),
    version: integer(row.version, "version"),
    createdAt: timestamp(row.created_at, "created_at"),
    updatedAt: timestamp(row.updated_at, "updated_at"),
    appliedReceipts: [],
    ...(claimId && claimantId && claimExpiresAt
      ? { claim: { claimId, claimantId, expiresAt: claimExpiresAt } }
      : {}),
    ...(row.started_at
      ? { startedAt: timestamp(row.started_at, "started_at") }
      : {}),
    ...(row.ended_at
      ? { endedAt: timestamp(row.ended_at, "ended_at") }
      : {}),
    ...(row.terminal_reason
      ? { terminalReason: boundedWorkValue(
          String(row.terminal_reason),
          "terminal_reason",
          120,
        ) }
      : {}),
  };
}

export function parseAgentWorkAnnouncement(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.announcementText !== "string" ||
      !input.announcementText.trim() ||
      Buffer.byteLength(input.announcementText) > 800 ||
      typeof input.resultHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(input.resultHash)) {
    return null;
  }
  const announcementText = input.announcementText.trim();
  return {
    announcementText,
    announcementHash: createHash("sha256")
      .update(announcementText)
      .digest("hex"),
    resultHash: input.resultHash,
  };
}

export class AgentDeliveryRecordError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentDeliveryRecordError";
  }
}

function required(value: unknown, name: string) {
  return boundedWorkValue(String(value), name, 160);
}

function optionalText(value: unknown, name: string, maximum: number) {
  return value === null || value === undefined
    ? undefined
    : boundedWorkValue(String(value), name, maximum);
}

function integer(
  value: unknown,
  name: string,
  minimum = 1,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  return boundedWorkInteger(Number(value), name, minimum, maximum);
}

function optionalInteger(value: unknown, name: string) {
  return value === null || value === undefined
    ? undefined
    : integer(value, name);
}

function timestamp(value: unknown, name: string) {
  return validWorkDate(new Date(String(value)), name).toISOString();
}

function optionalTimestamp(value: unknown, name: string) {
  return value === null || value === undefined ? undefined : timestamp(value, name);
}

function hash(value: unknown, name: string) {
  const normalized = boundedWorkValue(String(value), name, 64, 64);
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new AgentDeliveryRecordError(`${name}_invalid`);
  }
  return normalized;
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  name: string,
): Values[number] {
  if (typeof value !== "string" ||
      !(values as readonly string[]).includes(value)) {
    throw new AgentDeliveryRecordError(`delivery_${name}_invalid`);
  }
  return value as Values[number];
}
