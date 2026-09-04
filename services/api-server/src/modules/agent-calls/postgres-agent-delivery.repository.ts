import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AgentDeliveryBinding } from "@translation/contracts";
import { repositoryRequestHash } from
  "../../infrastructure/storage/repository-command-identity.js";
import {
  agentDeliveryFromRow,
  AgentDeliveryRecordError,
  parseAgentWorkAnnouncement,
  type AgentDeliveryRow,
} from "./agent-delivery-record.js";
import {
  AgentWorkPostgresSupport,
  boundedWorkInteger,
  boundedWorkValue,
  lockWork,
  validWorkDate,
} from "./postgres-agent-work-support.js";
import {
  assertDeliveryActiveScope,
  assertDeliveryClaim,
  deliveryCommand,
  enqueueDeliveryEvent,
  lockDelivery,
  recordDeliveryCommand,
  requireAgentDelivery,
  type AgentDeliveryCommandResult,
} from "./postgres-agent-delivery-support.js";
import {
  announcementForDelivery,
  assertCurrentDeliveryBindings,
  normalizeDeliveryPreparation,
} from "./postgres-agent-delivery-preparation.js";

type CandidateRow = Record<string, unknown> & {
  work_id: string;
  result_summary: unknown;
};

export class PostgresAgentDeliveriesRepository {
  private readonly support: AgentWorkPostgresSupport;

  constructor(pool: Pick<Pool, "connect">) {
    this.support = new AgentWorkPostgresSupport(pool);
  }

  async materialize(input: { limit?: number; now?: Date } = {}) {
    const limit = boundedWorkInteger(input.limit ?? 25, "delivery_limit", 1, 25);
    const now = validWorkDate(input.now ?? new Date(), "delivery_now");
    return this.support.transaction(async (client, transaction) => {
      const candidates = await client.query<CandidateRow>(`
        SELECT work.work_id, work.session_id, work.leg_id, work.turn_id,
          work.turn_generation, work.dispatch_generation, work.result_summary,
          ownership.account_id, ownership.client_instance_id,
          ownership.participant_identity, ownership.lease_id,
          ownership.generation AS ownership_generation,
          COALESCE(latest.delivery_attempt_number, 0) + 1
            AS delivery_attempt_number
        FROM ai_phone.agent_works AS work
        JOIN ai_phone.agent_voice_turn_scopes AS scope
          ON scope.session_id = work.session_id AND scope.leg_id = work.leg_id
        JOIN ai_phone.voice_client_ownerships AS ownership
          ON ownership.session_id = work.session_id
          AND ownership.leg_id = work.leg_id
        LEFT JOIN LATERAL (
          SELECT attempt.delivery_attempt_number, attempt.status,
            attempt.available_at
          FROM ai_phone.agent_delivery_attempts AS attempt
          WHERE attempt.work_id = work.work_id
          ORDER BY attempt.delivery_attempt_number DESC LIMIT 1
        ) AS latest ON true
        WHERE work.status = 'completed'
          AND work.ended_at > $1::timestamptz - interval '5 minutes'
          AND scope.state = 'active'
          AND scope.current_turn_id = work.turn_id
          AND scope.turn_generation = work.turn_generation
          AND scope.dispatch_generation = work.dispatch_generation
          AND ownership.state = 'active'
          AND ownership.lease_expires_at > $1::timestamptz
          AND jsonb_typeof(work.result_summary) = 'object'
          AND length(trim(work.result_summary->>'announcementText'))
            BETWEEN 1 AND 800
          AND NOT EXISTS (
            SELECT 1 FROM ai_phone.agent_delivery_attempts AS active
            WHERE active.work_id = work.work_id AND active.status IN (
              'generated', 'claimed', 'queued_for_playback', 'playback_started'
            )
          )
          AND (
            latest.delivery_attempt_number IS NULL
            OR (latest.status = 'failed' AND latest.available_at <= $1)
          )
          AND COALESCE(latest.delivery_attempt_number, 0) < 3
        ORDER BY work.ended_at, work.work_id
        FOR UPDATE OF work SKIP LOCKED
        LIMIT $2
      `, [now.toISOString(), limit]);
      const created = [];
      for (const candidate of candidates.rows) {
        const announcement = parseAgentWorkAnnouncement(candidate.result_summary);
        if (!announcement) continue;
        const deliveryAttemptId = randomUUID();
        const expiresAt = new Date(now.getTime() + 5 * 60_000);
        const result = await client.query<AgentDeliveryRow>(`
          INSERT INTO ai_phone.agent_delivery_attempts(
            delivery_attempt_id, work_id, delivery_attempt_number,
            session_id, leg_id, turn_id, turn_generation, dispatch_generation,
            account_id, client_instance_id, client_participant_identity,
            ownership_lease_id, ownership_generation, announcement_hash,
            status, server_playback_state, available_at, expires_at,
            version, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
            $14, 'generated', 'none', $15::timestamptz, $16::timestamptz,
            1, $15::timestamptz, $15::timestamptz
          ) ON CONFLICT DO NOTHING RETURNING *
        `, [
          deliveryAttemptId,
          candidate.work_id,
          candidate.delivery_attempt_number,
          candidate.session_id,
          candidate.leg_id,
          candidate.turn_id,
          candidate.turn_generation,
          candidate.dispatch_generation,
          candidate.account_id,
          candidate.client_instance_id,
          candidate.participant_identity,
          candidate.lease_id,
          candidate.ownership_generation,
          announcement.announcementHash,
          now.toISOString(),
          expiresAt.toISOString(),
        ]);
        if (!result.rows[0]) continue;
        const record = agentDeliveryFromRow(result.rows[0]);
        await enqueueDeliveryEvent(transaction, deliveryAttemptId,
          "agent.delivery.generated", record, now);
        created.push(record);
      }
      return created;
    });
  }

  async claim(input: {
    owner: string;
    limit: number;
    leaseSeconds: number;
    ownerConcurrency: number;
    batchId?: string;
    now?: Date;
  }) {
    const now = validWorkDate(input.now ?? new Date(), "delivery_claim_now");
    return this.support.transaction(async (client, transaction) => {
      const claimed = await client.query<AgentDeliveryRow>(
        "SELECT * FROM ai_phone.claim_agent_deliveries($1, $2, $3, $4, $5, $6)",
        [
          boundedWorkValue(input.owner, "delivery_owner", 200, 8),
          boundedWorkValue(input.batchId ?? randomUUID(),
            "delivery_batch", 160, 8),
          boundedWorkInteger(input.limit, "delivery_limit", 1, 25),
          boundedWorkInteger(input.leaseSeconds, "delivery_lease", 5, 120),
          boundedWorkInteger(
            input.ownerConcurrency,
            "delivery_owner_concurrency",
            1,
            8,
          ),
          now.toISOString(),
        ],
      );
      const records = claimed.rows.map(agentDeliveryFromRow);
      for (const record of records) {
        await enqueueDeliveryEvent(transaction, record.claim!.claimId,
          "agent.delivery.claimed", record, now);
      }
      return records;
    });
  }

  async preparePlayback(input: {
    deliveryAttemptId: string;
    claimId: string;
    owner: string;
    playbackId: string;
    workerParticipantIdentity: string;
    commandId: string;
    now?: Date;
  }) {
    const normalized = normalizeDeliveryPreparation(input);
    const requestHash = repositoryRequestHash(normalized.identity);
    const command = deliveryCommand({
      commandId: normalized.commandId,
      deliveryAttemptId: normalized.deliveryAttemptId,
      commandType: "agent.delivery.queue",
      requestHash,
    });
    return this.support.transaction(async (client, transaction) => {
      await lockDelivery(client, normalized.deliveryAttemptId);
      const replay = await transaction
        .readCommandResult<AgentDeliveryCommandResult>(command);
      if (replay) {
        const record = await requireAgentDelivery(
          client,
          normalized.deliveryAttemptId,
        );
        return {
          replayed: true,
          record,
          announcementText: await announcementForDelivery(client, record),
        };
      }
      const current = await requireAgentDelivery(
        client,
        normalized.deliveryAttemptId,
        true,
      );
      assertDeliveryClaim(current, normalized);
      if (Date.parse(current.expiresAt) <= normalized.now.getTime()) {
        throw new AgentDeliveryRecordError("delivery_expired");
      }
      await assertCurrentDeliveryBindings(client, current, normalized.now);
      const announcementText = await announcementForDelivery(client, current);
      await lockWork(
        client,
        `agent-delivery-playback:${current.sessionId}:${current.legId}`,
      );
      const generation = await client.query<{ next_generation: unknown }>(`
        SELECT COALESCE(max(playback_generation), 0) + 1 AS next_generation
        FROM ai_phone.agent_delivery_attempts
        WHERE session_id = $1 AND leg_id = $2
      `, [current.sessionId, current.legId]);
      const playbackGeneration = boundedWorkInteger(
        Number(generation.rows[0]?.next_generation),
        "playback_generation",
        1,
        Number.MAX_SAFE_INTEGER,
      );
      const updated = await client.query<AgentDeliveryRow>(`
        UPDATE ai_phone.agent_delivery_attempts
        SET status = 'queued_for_playback', playback_id = $2,
          playback_generation = $3, worker_participant_identity = $4,
          claim_id = NULL, claim_owner = NULL,
          claim_expires_at = NULL, version = version + 1,
          updated_at = $5::timestamptz
        WHERE delivery_attempt_id = $1 RETURNING *
      `, [current.deliveryAttemptId, normalized.playbackId,
        playbackGeneration, normalized.workerParticipantIdentity,
        normalized.now.toISOString()]);
      const record = agentDeliveryFromRow(updated.rows[0]!);
      await enqueueDeliveryEvent(transaction, normalized.commandId,
        "agent.delivery.queued", record, normalized.now);
      await recordDeliveryCommand(transaction, command, record, normalized.now);
      return { replayed: false, record, announcementText };
    });
  }

  async authorize(binding: AgentDeliveryBinding, now = new Date()) {
    const checkedNow = validWorkDate(now, "delivery_authorize_now");
    const client = await this.support.pool.connect();
    try {
      const record = await requireAgentDelivery(
        client,
        boundedWorkValue(binding.deliveryAttemptId,
          "delivery_attempt_id", 160),
      );
      if (!["queued_for_playback", "playback_started"].includes(record.status) ||
          Date.parse(record.expiresAt) <= checkedNow.getTime() ||
          record.workId !== binding.workId ||
          record.sessionId !== binding.sessionId || record.legId !== binding.legId ||
          record.playbackId !== binding.playbackId ||
          record.playbackGeneration !== binding.playbackGeneration) {
        throw new AgentDeliveryRecordError("delivery_authorization_invalid");
      }
      assertDeliveryActiveScope(record, binding);
      await assertCurrentDeliveryBindings(client, record, checkedNow);
      return { record, announcementText: await announcementForDelivery(client, record) };
    } finally {
      client.release();
    }
  }

  async find(deliveryAttemptId: string) {
    const client = await this.support.pool.connect();
    try {
      const result = await client.query<AgentDeliveryRow>(`
        SELECT * FROM ai_phone.agent_delivery_attempts
        WHERE delivery_attempt_id = $1
      `, [boundedWorkValue(deliveryAttemptId, "delivery_attempt_id", 160)]);
      return result.rows[0] ? agentDeliveryFromRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }
}
