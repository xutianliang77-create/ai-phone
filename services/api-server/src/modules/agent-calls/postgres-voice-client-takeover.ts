import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { repositoryRequestHash } from
  "../../infrastructure/storage/repository-command-identity.js";
import {
  voiceClientOwnershipFromRow,
  voiceClientTakeoverFromRow,
  VoiceClientOwnershipConflict,
  type VoiceClientOwnershipRow,
  type VoiceClientTakeoverRow,
} from "./voice-client-ownership-record.js";
import {
  AgentWorkPostgresSupport,
  boundedWorkInteger,
  boundedWorkValue,
  validWorkDate,
} from "./postgres-agent-work-support.js";
import {
  enqueueVoiceOwnershipEvent,
  lockVoiceOwnership,
  recordVoiceOwnershipCommand,
  requireVoiceOwnership,
  voiceOwnershipCommand,
  type VoiceOwnershipCommandResult,
} from "./postgres-voice-client-ownership-support.js";

export interface RequestVoiceClientTakeoverInput {
  takeoverId: string;
  sessionId: string;
  legId: string;
  accountId: string;
  clientInstanceId: string;
  participantIdentity: string;
  expectedGeneration: number;
  commandId: string;
  now?: Date;
}

export async function requestVoiceClientTakeover(
  support: AgentWorkPostgresSupport,
  input: RequestVoiceClientTakeoverInput,
) {
  const normalized = normalizeTakeover(input);
  const expiresAt = new Date(normalized.now.getTime() + 15_000);
  const requestHash = repositoryRequestHash(takeoverRequestIdentity(normalized));
  const command = voiceOwnershipCommand({
    ...normalized,
    commandType: "voice.ownership.takeover.request",
    requestHash,
  });
  return support.transaction(async (client, transaction) => {
    await lockVoiceOwnership(client, normalized.sessionId, normalized.legId);
    const replay = await transaction
      .readCommandResult<VoiceOwnershipCommandResult>(command);
    if (replay) {
      return {
        replayed: true,
        takeover: replay.takeover ?? await requireTakeover(
          client,
          normalized.takeoverId,
        ),
      };
    }
    const current = await requireVoiceOwnership(
      client,
      normalized.sessionId,
      normalized.legId,
      true,
    );
    if (current.accountId !== normalized.accountId ||
      current.state !== "active" ||
      Date.parse(current.leaseExpiresAt) <= normalized.now.getTime() ||
      current.generation !== normalized.expectedGeneration) {
      throw new VoiceClientOwnershipConflict("voice_takeover_scope_invalid");
    }
    if (current.clientInstanceId === normalized.clientInstanceId &&
      current.participantIdentity === normalized.participantIdentity) {
      throw new VoiceClientOwnershipConflict("voice_takeover_same_client");
    }
    await client.query(`
      UPDATE ai_phone.voice_client_takeovers
      SET status = 'expired', updated_at = $3::timestamptz
      WHERE session_id = $1 AND leg_id = $2 AND status = 'pending'
        AND expires_at <= $3::timestamptz
    `, [normalized.sessionId, normalized.legId, normalized.now.toISOString()]);
    const existing = await client.query<VoiceClientTakeoverRow>(`
      SELECT * FROM ai_phone.voice_client_takeovers
      WHERE takeover_id = $1 OR (
        session_id = $2 AND leg_id = $3 AND status = 'pending'
      ) FOR UPDATE
    `, [normalized.takeoverId, normalized.sessionId, normalized.legId]);
    if (existing.rows.length > 1) {
      throw new VoiceClientOwnershipConflict("voice_takeover_identity_conflict");
    }
    if (existing.rows[0]) {
      const takeover = voiceClientTakeoverFromRow(existing.rows[0]);
      if (takeover.takeoverId !== normalized.takeoverId ||
        String(existing.rows[0].request_hash) !== requestHash) {
        throw new VoiceClientOwnershipConflict("voice_takeover_pending_conflict");
      }
      await recordVoiceOwnershipCommand(transaction, command, {
        status: takeover.status,
        sessionId: takeover.sessionId,
        legId: takeover.legId,
        generation: takeover.expectedGeneration,
        version: current.version,
        takeoverId: takeover.takeoverId,
        takeover,
      }, normalized.now);
      return { replayed: true, takeover };
    }
    const result = await client.query<VoiceClientTakeoverRow>(`
      INSERT INTO ai_phone.voice_client_takeovers(
        takeover_id, session_id, leg_id, account_id,
        requested_client_instance_id, requested_participant_identity,
        expected_generation, status, request_hash, expires_at,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8,
        $9::timestamptz, $10::timestamptz, $10::timestamptz)
      RETURNING *
    `, [
      normalized.takeoverId,
      normalized.sessionId,
      normalized.legId,
      normalized.accountId,
      normalized.clientInstanceId,
      normalized.participantIdentity,
      normalized.expectedGeneration,
      requestHash,
      expiresAt.toISOString(),
      normalized.now.toISOString(),
    ]);
    const takeover = voiceClientTakeoverFromRow(result.rows[0]!);
    await enqueueVoiceOwnershipEvent(transaction, command.commandId,
      "voice.ownership.takeover_requested", current, normalized.now, {
        takeoverId: takeover.takeoverId,
        expectedGeneration: takeover.expectedGeneration,
      });
    await recordVoiceOwnershipCommand(transaction, command, {
      status: takeover.status,
      sessionId: takeover.sessionId,
      legId: takeover.legId,
      generation: takeover.expectedGeneration,
      version: current.version,
      takeoverId: takeover.takeoverId,
      takeover,
    }, normalized.now);
    return { replayed: false, takeover };
  });
}

export interface ConfirmVoiceClientTakeoverInput extends
  RequestVoiceClientTakeoverInput {
  leaseSeconds?: number;
}

export async function confirmVoiceClientTakeover(
  support: AgentWorkPostgresSupport,
  input: ConfirmVoiceClientTakeoverInput,
) {
  const normalized = normalizeTakeover(input);
  const leaseSeconds = boundedWorkInteger(
    input.leaseSeconds ?? 60,
    "voice_ownership_lease_seconds",
    15,
    120,
  );
  const requestHash = repositoryRequestHash({
    ...takeoverRequestIdentity(normalized),
    leaseSeconds,
  });
  const command = voiceOwnershipCommand({
    ...normalized,
    commandType: "voice.ownership.takeover.confirm",
    requestHash,
  });
  return support.transaction(async (client, transaction) => {
    await lockVoiceOwnership(client, normalized.sessionId, normalized.legId);
    const replay = await transaction
      .readCommandResult<VoiceOwnershipCommandResult>(command);
    if (replay) {
      return {
        replayed: true,
        ownership: replay.ownership ?? await requireVoiceOwnership(
          client,
          normalized.sessionId,
          normalized.legId,
        ),
        takeover: replay.takeover ?? await requireTakeover(
          client,
          normalized.takeoverId,
        ),
      };
    }
    const current = await requireVoiceOwnership(
      client,
      normalized.sessionId,
      normalized.legId,
      true,
    );
    const takeoverRow = await requireTakeoverRow(
      client,
      normalized.takeoverId,
      true,
    );
    const takeover = voiceClientTakeoverFromRow(takeoverRow);
    if (current.accountId !== normalized.accountId ||
      current.generation !== normalized.expectedGeneration ||
      takeover.status !== "pending" ||
      takeover.sessionId !== normalized.sessionId ||
      takeover.legId !== normalized.legId ||
      takeover.accountId !== normalized.accountId ||
      takeover.expectedGeneration !== normalized.expectedGeneration ||
      takeover.requestedClientInstanceId !== normalized.clientInstanceId ||
      takeover.requestedParticipantIdentity !== normalized.participantIdentity ||
      Date.parse(takeover.expiresAt) <= normalized.now.getTime()) {
      throw new VoiceClientOwnershipConflict("voice_takeover_confirmation_invalid");
    }
    const nextLeaseId = randomUUID();
    const leaseExpiresAt = new Date(
      normalized.now.getTime() + leaseSeconds * 1_000,
    );
    const updated = await client.query<VoiceClientOwnershipRow>(`
      UPDATE ai_phone.voice_client_ownerships
      SET client_instance_id = $3, participant_identity = $4,
        generation = generation + 1, lease_id = $5,
        lease_expires_at = $6::timestamptz, state = 'active',
        released_at = NULL, release_reason = NULL,
        version = version + 1, updated_at = $7::timestamptz
      WHERE session_id = $1 AND leg_id = $2 RETURNING *
    `, [
      normalized.sessionId,
      normalized.legId,
      normalized.clientInstanceId,
      normalized.participantIdentity,
      nextLeaseId,
      leaseExpiresAt.toISOString(),
      normalized.now.toISOString(),
    ]);
    const ownership = voiceClientOwnershipFromRow(updated.rows[0]!);
    const confirmed = await client.query<VoiceClientTakeoverRow>(`
      UPDATE ai_phone.voice_client_takeovers
      SET status = 'confirmed', confirmed_at = $2::timestamptz,
        updated_at = $2::timestamptz
      WHERE takeover_id = $1 RETURNING *
    `, [normalized.takeoverId, normalized.now.toISOString()]);
    const confirmedTakeover = voiceClientTakeoverFromRow(confirmed.rows[0]!);
    await enqueueVoiceOwnershipEvent(transaction, command.commandId,
      "voice.ownership.takeover_confirmed", ownership, normalized.now, {
        takeoverId: confirmedTakeover.takeoverId,
        previousGeneration: normalized.expectedGeneration,
      });
    await recordVoiceOwnershipCommand(transaction, command, {
      status: ownership.state,
      sessionId: ownership.sessionId,
      legId: ownership.legId,
      generation: ownership.generation,
      version: ownership.version,
      takeoverId: confirmedTakeover.takeoverId,
      ownership,
      takeover: confirmedTakeover,
    }, normalized.now);
    return {
      replayed: false,
      ownership,
      takeover: confirmedTakeover,
    };
  });
}

function normalizeTakeover(input: RequestVoiceClientTakeoverInput) {
  return {
    takeoverId: boundedWorkValue(input.takeoverId, "takeover_id", 160),
    sessionId: boundedWorkValue(input.sessionId, "session_id", 160),
    legId: boundedWorkValue(input.legId, "leg_id", 160),
    accountId: boundedWorkValue(input.accountId, "account_id", 160),
    clientInstanceId:
      boundedWorkValue(input.clientInstanceId, "client_instance_id", 160),
    participantIdentity:
      boundedWorkValue(input.participantIdentity, "participant_identity", 320),
    expectedGeneration: boundedWorkInteger(
      input.expectedGeneration,
      "expected_generation",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    commandId: boundedWorkValue(input.commandId, "command_id", 200),
    now: validWorkDate(input.now ?? new Date(), "voice_takeover_now"),
  };
}

function takeoverRequestIdentity(input: ReturnType<typeof normalizeTakeover>) {
  return {
    takeoverId: input.takeoverId,
    sessionId: input.sessionId,
    legId: input.legId,
    accountId: input.accountId,
    clientInstanceId: input.clientInstanceId,
    participantIdentity: input.participantIdentity,
    expectedGeneration: input.expectedGeneration,
  };
}

async function requireTakeover(
  client: Pick<PoolClient, "query">,
  takeoverId: string,
) {
  return voiceClientTakeoverFromRow(
    await requireTakeoverRow(client, takeoverId),
  );
}

async function requireTakeoverRow(
  client: Pick<PoolClient, "query">,
  takeoverId: string,
  forUpdate = false,
) {
  const result = await client.query<VoiceClientTakeoverRow>(`
    SELECT * FROM ai_phone.voice_client_takeovers
    WHERE takeover_id = $1 ${forUpdate ? "FOR UPDATE" : ""}
  `, [takeoverId]);
  if (!result.rows[0]) {
    throw new VoiceClientOwnershipConflict("voice_takeover_not_found");
  }
  return result.rows[0];
}
