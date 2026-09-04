import type { PoolClient } from "pg";
import { domainEventId } from
  "../../infrastructure/storage/postgres-domain-record-uow.js";
import type {
  PostgresPrimaryTransaction,
  PrimaryCommandIdentity,
} from "../../infrastructure/storage/postgres-primary-store.js";
import type { VoiceClientOwnershipRecord } from
  "./voice-client-ownership-record.js";
import type { VoiceClientTakeoverDto } from "@translation/contracts";
import {
  voiceClientOwnershipFromRow,
  VoiceClientOwnershipConflict,
  type VoiceClientOwnershipRow,
} from "./voice-client-ownership-record.js";
import {
  boundedWorkValue,
  lockWork,
} from "./postgres-agent-work-support.js";

const commandRetentionMs = 90 * 24 * 60 * 60 * 1_000;

export interface VoiceOwnershipCommandResult {
  status: string;
  sessionId: string;
  legId: string;
  generation: number;
  version: number;
  takeoverId?: string;
  ownership?: VoiceClientOwnershipRecord;
  takeover?: VoiceClientTakeoverDto;
}

export function voiceOwnershipCommand(input: {
  commandId: string;
  sessionId: string;
  legId: string;
  commandType: string;
  requestHash: string;
}): PrimaryCommandIdentity {
  return {
    commandId: boundedWorkValue(input.commandId, "command_id", 200),
    aggregateType: "voice_client_ownership",
    aggregateId: `${input.sessionId}:${input.legId}`,
    commandType: input.commandType,
    requestHash: input.requestHash,
  };
}

export function lockVoiceOwnership(
  client: Pick<PoolClient, "query">,
  sessionId: string,
  legId: string,
) {
  return lockWork(client, `voice-ownership:${sessionId}:${legId}`);
}

export async function findVoiceOwnership(
  client: Pick<PoolClient, "query">,
  sessionId: string,
  legId: string,
  forUpdate = false,
) {
  const result = await client.query<VoiceClientOwnershipRow>(`
    SELECT * FROM ai_phone.voice_client_ownerships
    WHERE session_id = $1 AND leg_id = $2
    ${forUpdate ? "FOR UPDATE" : ""}
  `, [sessionId, legId]);
  return result.rows[0] ? voiceClientOwnershipFromRow(result.rows[0]) : null;
}

export async function requireVoiceOwnership(
  client: Pick<PoolClient, "query">,
  sessionId: string,
  legId: string,
  forUpdate = false,
) {
  const ownership = await findVoiceOwnership(
    client,
    sessionId,
    legId,
    forUpdate,
  );
  if (!ownership) {
    throw new VoiceClientOwnershipConflict("voice_ownership_not_found");
  }
  return ownership;
}

export function recordVoiceOwnershipCommand(
  transaction: PostgresPrimaryTransaction,
  command: PrimaryCommandIdentity,
  result: VoiceOwnershipCommandResult,
  now: Date,
) {
  return transaction.recordCommandResult({
    ...command,
    result,
    retainUntil: new Date(now.getTime() + commandRetentionMs).toISOString(),
  });
}

export function enqueueVoiceOwnershipEvent(
  transaction: PostgresPrimaryTransaction,
  eventIdentity: string,
  eventType: string,
  ownership: VoiceClientOwnershipRecord,
  now: Date,
  extra: Record<string, unknown> = {},
) {
  const eventId = domainEventId(eventIdentity, eventType);
  return transaction.enqueueOutbox({
    id: eventId,
    idempotencyKey: eventId,
    sessionId: ownership.sessionId,
    aggregateVersion: ownership.version,
    sequence: ownership.version,
    eventType,
    eventVersion: 1,
    payload: {
      sessionId: ownership.sessionId,
      legId: ownership.legId,
      clientInstanceId: ownership.clientInstanceId,
      participantIdentity: ownership.participantIdentity,
      generation: ownership.generation,
      leaseId: ownership.leaseId,
      leaseExpiresAt: ownership.leaseExpiresAt,
      state: ownership.state,
      version: ownership.version,
      occurredAt: now.toISOString(),
      ...extra,
    },
  });
}
