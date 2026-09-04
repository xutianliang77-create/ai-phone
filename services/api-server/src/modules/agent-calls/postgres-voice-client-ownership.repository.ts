import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { repositoryRequestHash } from
  "../../infrastructure/storage/repository-command-identity.js";
import {
  assertActiveVoiceClientOwnership,
  voiceClientOwnershipFromRow,
  VoiceClientOwnershipConflict,
  type VoiceClientOwnershipRow,
} from "./voice-client-ownership-record.js";
import { AgentWorkPostgresSupport, boundedWorkInteger, boundedWorkValue,
  validWorkDate } from "./postgres-agent-work-support.js";
import {
  enqueueVoiceOwnershipEvent,
  findVoiceOwnership,
  lockVoiceOwnership,
  recordVoiceOwnershipCommand,
  requireVoiceOwnership,
  voiceOwnershipCommand,
  type VoiceOwnershipCommandResult,
} from "./postgres-voice-client-ownership-support.js";
import { requestVoiceClientTakeover, confirmVoiceClientTakeover } from
  "./postgres-voice-client-takeover.js";

export class PostgresVoiceClientOwnershipRepository {
  private readonly support: AgentWorkPostgresSupport;

  constructor(pool: Pick<Pool, "connect">) {
    this.support = new AgentWorkPostgresSupport(pool);
  }

  async acquire(input: VoiceOwnershipBaseInput & { leaseSeconds?: number }) {
    const normalized = normalizeBase(input);
    const leaseSeconds = boundedWorkInteger(
      input.leaseSeconds ?? 60,
      "voice_ownership_lease_seconds",
      15,
      120,
    );
    const requestHash = repositoryRequestHash({
      ...ownershipRequestIdentity(normalized),
      leaseSeconds,
    });
    const command = voiceOwnershipCommand({
      ...normalized,
      commandType: "voice.ownership.acquire",
      requestHash,
    });
    return this.support.transaction(async (client, transaction) => {
      await lockVoiceOwnership(client, normalized.sessionId, normalized.legId);
      const replay = await transaction
        .readCommandResult<VoiceOwnershipCommandResult>(command);
      if (replay) {
        return {
          replayed: true,
          ownership: replay.ownership ?? await requireVoiceOwnership(
            client, normalized.sessionId, normalized.legId,
          ),
        };
      }
      const current = await findVoiceOwnership(
        client,
        normalized.sessionId,
        normalized.legId,
        true,
      );
      if (current?.accountId && current.accountId !== normalized.accountId) {
        throw new VoiceClientOwnershipConflict("voice_ownership_account_conflict");
      }
      const currentActive = current?.state === "active" &&
        Date.parse(current.leaseExpiresAt) > normalized.now.getTime();
      if (currentActive && (current.clientInstanceId !== normalized.clientInstanceId ||
        current.participantIdentity !== normalized.participantIdentity)) {
        throw new VoiceClientOwnershipConflict("voice_ownership_already_active");
      }
      if (currentActive) {
        await recordVoiceOwnershipCommand(transaction, command, {
          status: current.state,
          sessionId: current.sessionId,
          legId: current.legId,
          generation: current.generation,
          version: current.version,
          ownership: current,
        }, normalized.now);
        return { replayed: false, ownership: current };
      }
      const leaseId = randomUUID();
      const leaseExpiresAt = new Date(
        normalized.now.getTime() + leaseSeconds * 1_000,
      );
      const nextGeneration = (current?.generation ?? 0) + 1;
      const result = await client.query<VoiceClientOwnershipRow>(`
        INSERT INTO ai_phone.voice_client_ownerships(
          session_id, leg_id, account_id, client_instance_id,
          participant_identity, generation, lease_id, lease_expires_at,
          state, version, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz,
          'active', 1, $9::timestamptz, $9::timestamptz)
        ON CONFLICT(session_id, leg_id) DO UPDATE SET
          client_instance_id = EXCLUDED.client_instance_id,
          participant_identity = EXCLUDED.participant_identity,
          generation = EXCLUDED.generation,
          lease_id = EXCLUDED.lease_id,
          lease_expires_at = EXCLUDED.lease_expires_at,
          state = 'active', released_at = NULL, release_reason = NULL,
          version = ai_phone.voice_client_ownerships.version + 1,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `, [
        normalized.sessionId,
        normalized.legId,
        normalized.accountId,
        normalized.clientInstanceId,
        normalized.participantIdentity,
        nextGeneration,
        leaseId,
        leaseExpiresAt.toISOString(),
        normalized.now.toISOString(),
      ]);
      const ownership = voiceClientOwnershipFromRow(result.rows[0]!);
      await enqueueVoiceOwnershipEvent(transaction, command.commandId,
        "voice.ownership.acquired", ownership, normalized.now);
      await recordVoiceOwnershipCommand(transaction, command, {
        status: ownership.state,
        sessionId: ownership.sessionId,
        legId: ownership.legId,
        generation: ownership.generation,
        version: ownership.version,
        ownership,
      }, normalized.now);
      return { replayed: false, ownership };
    });
  }

  async renew(input: VoiceOwnershipLeaseInput & { leaseSeconds?: number }) {
    const normalized = normalizeLease(input);
    const leaseSeconds = boundedWorkInteger(
      input.leaseSeconds ?? 60,
      "voice_ownership_lease_seconds",
      15,
      120,
    );
    return this.mutateActive(
      normalized,
      "voice.ownership.renew",
      { leaseSeconds },
      async (client, current) => {
        const leaseExpiresAt = new Date(
          normalized.now.getTime() + leaseSeconds * 1_000,
        );
        const result = await client.query<VoiceClientOwnershipRow>(`
          UPDATE ai_phone.voice_client_ownerships
          SET lease_expires_at = $3::timestamptz,
            version = version + 1, updated_at = $4::timestamptz
          WHERE session_id = $1 AND leg_id = $2 RETURNING *
        `, [normalized.sessionId, normalized.legId,
          leaseExpiresAt.toISOString(), normalized.now.toISOString()]);
        return {
          ownership: voiceClientOwnershipFromRow(result.rows[0]!),
          eventType: "voice.ownership.renewed",
          previousGeneration: current.generation,
        };
      },
    );
  }

  async release(input: VoiceOwnershipLeaseInput & { reason: string }) {
    const normalized = normalizeLease(input);
    const reason = boundedWorkValue(input.reason, "release_reason", 120);
    return this.mutateActive(
      normalized,
      "voice.ownership.release",
      { reason },
      async (client, current) => {
        const result = await client.query<VoiceClientOwnershipRow>(`
          UPDATE ai_phone.voice_client_ownerships
          SET state = 'released', generation = generation + 1,
            lease_expires_at = $3::timestamptz, released_at = $3::timestamptz,
            release_reason = $4, version = version + 1,
            updated_at = $3::timestamptz
          WHERE session_id = $1 AND leg_id = $2 RETURNING *
        `, [normalized.sessionId, normalized.legId,
          normalized.now.toISOString(), reason]);
        return {
          ownership: voiceClientOwnershipFromRow(result.rows[0]!),
          eventType: "voice.ownership.released",
          previousGeneration: current.generation,
        };
      },
    );
  }

  requestTakeover(input: Parameters<typeof requestVoiceClientTakeover>[1]) {
    return requestVoiceClientTakeover(this.support, input);
  }

  confirmTakeover(input: Parameters<typeof confirmVoiceClientTakeover>[1]) {
    return confirmVoiceClientTakeover(this.support, input);
  }

  async findActive(sessionId: string, legId: string, now = new Date()) {
    const client = await this.support.pool.connect();
    try {
      const current = await findVoiceOwnership(
        client,
        boundedWorkValue(sessionId, "session_id", 160),
        boundedWorkValue(legId, "leg_id", 160),
      );
      return current?.state === "active" &&
          Date.parse(current.leaseExpiresAt) > validWorkDate(now, "now").getTime()
        ? current
        : null;
    } finally {
      client.release();
    }
  }

  private mutateActive(
    input: ReturnType<typeof normalizeLease>,
    commandType: string,
    request: Record<string, unknown>,
    mutation: (
      client: Pick<PoolClient, "query">,
      current: Awaited<ReturnType<typeof requireVoiceOwnership>>,
    ) => Promise<{
      ownership: Awaited<ReturnType<typeof requireVoiceOwnership>>;
      eventType: string;
      previousGeneration: number;
    }>,
  ) {
    const requestHash = repositoryRequestHash({
      ...ownershipRequestIdentity(input),
      leaseId: input.leaseId,
      generation: input.generation,
      ...request,
    });
    const command = voiceOwnershipCommand({ ...input, commandType, requestHash });
    return this.support.transaction(async (client, transaction) => {
      await lockVoiceOwnership(client, input.sessionId, input.legId);
      const replay = await transaction
        .readCommandResult<VoiceOwnershipCommandResult>(command);
      if (replay) {
        return {
          replayed: true,
          ownership: replay.ownership ?? await requireVoiceOwnership(
            client, input.sessionId, input.legId,
          ),
        };
      }
      const current = await requireVoiceOwnership(
        client,
        input.sessionId,
        input.legId,
        true,
      );
      assertActiveVoiceClientOwnership(current, input);
      const result = await mutation(client, current);
      await enqueueVoiceOwnershipEvent(transaction, command.commandId,
        result.eventType, result.ownership, input.now, {
          previousGeneration: result.previousGeneration,
        });
      await recordVoiceOwnershipCommand(transaction, command, {
        status: result.ownership.state,
        sessionId: result.ownership.sessionId,
        legId: result.ownership.legId,
        generation: result.ownership.generation,
        version: result.ownership.version,
        ownership: result.ownership,
      }, input.now);
      return { replayed: false, ownership: result.ownership };
    });
  }
}

interface VoiceOwnershipBaseInput {
  sessionId: string;
  legId: string;
  accountId: string;
  clientInstanceId: string;
  participantIdentity: string;
  commandId: string;
  now?: Date;
}

interface VoiceOwnershipLeaseInput extends VoiceOwnershipBaseInput {
  leaseId: string;
  generation: number;
}

function normalizeBase(input: VoiceOwnershipBaseInput) {
  return {
    sessionId: boundedWorkValue(input.sessionId, "session_id", 160),
    legId: boundedWorkValue(input.legId, "leg_id", 160),
    accountId: boundedWorkValue(input.accountId, "account_id", 160),
    clientInstanceId:
      boundedWorkValue(input.clientInstanceId, "client_instance_id", 160),
    participantIdentity:
      boundedWorkValue(input.participantIdentity, "participant_identity", 320),
    commandId: boundedWorkValue(input.commandId, "command_id", 200),
    now: validWorkDate(input.now ?? new Date(), "voice_ownership_now"),
  };
}

function normalizeLease(input: VoiceOwnershipLeaseInput) {
  return {
    ...normalizeBase(input),
    leaseId: boundedWorkValue(input.leaseId, "lease_id", 160),
    generation: boundedWorkInteger(
      input.generation,
      "voice_ownership_generation",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function ownershipRequestIdentity(input: ReturnType<typeof normalizeBase>) {
  return {
    sessionId: input.sessionId,
    legId: input.legId,
    accountId: input.accountId,
    clientInstanceId: input.clientInstanceId,
    participantIdentity: input.participantIdentity,
  };
}

export { VoiceClientOwnershipConflict };
