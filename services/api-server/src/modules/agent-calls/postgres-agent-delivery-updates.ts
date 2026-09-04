import type { Pool } from "pg";
import type {
  AgentDeliveryLifecycleEvent,
  ClientPlaybackReceipt,
} from "@translation/contracts";
import { repositoryRequestHash } from
  "../../infrastructure/storage/repository-command-identity.js";
import {
  agentDeliveryFromRow,
  AgentDeliveryRecordError,
  type AgentDeliveryRow,
} from "./agent-delivery-record.js";
import {
  AgentWorkPostgresSupport,
  boundedWorkValue,
  validWorkDate,
} from "./postgres-agent-work-support.js";
import {
  deliveryCommand,
  enqueueDeliveryEvent,
  lockDelivery,
  recordDeliveryCommand,
  requireAgentDelivery,
  type AgentDeliveryCommandResult,
} from "./postgres-agent-delivery-support.js";
import { enqueueAgentDeliveryClientEvent } from
  "./postgres-agent-delivery-client-events.repository.js";
import {
  assertCurrentReceiptOwner,
  assertLifecycleBinding,
  assertReceiptBinding,
  isTerminalDelivery,
  lifecycleTransition,
  receiptTransition,
} from "./postgres-agent-delivery-transitions.js";

export class PostgresAgentDeliveryUpdates {
  private readonly support: AgentWorkPostgresSupport;

  constructor(pool: Pick<Pool, "connect">) {
    this.support = new AgentWorkPostgresSupport(pool);
  }

  async converge(input: { now?: Date; limit?: number } = {}) {
    const now = validWorkDate(input.now ?? new Date(), "delivery_converge_now");
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    return this.support.transaction(async (client, transaction) => {
      const candidates = await client.query<AgentDeliveryRow>(`
        SELECT * FROM ai_phone.agent_delivery_attempts
        WHERE status IN (
          'generated', 'claimed', 'queued_for_playback', 'playback_started'
        ) AND (
          expires_at <= $1::timestamptz
          OR (status = 'queued_for_playback'
            AND server_playback_state = 'none'
            AND updated_at <= $1::timestamptz - interval '30 seconds')
          OR (status = 'playback_started'
            AND updated_at <= $1::timestamptz - interval '180 seconds')
        )
        ORDER BY expires_at, updated_at, delivery_attempt_id
        FOR UPDATE SKIP LOCKED LIMIT $2
      `, [now.toISOString(), limit]);
      const records = [];
      for (const row of candidates.rows) {
        const current = agentDeliveryFromRow(row);
        const expired = Date.parse(current.expiresAt) <= now.getTime();
        const status = expired ? "expired" : "failed";
        const reason = expired
          ? "delivery_window_expired"
          : current.status === "playback_started"
            ? "client_playback_receipt_timeout"
            : "worker_playback_ack_timeout";
        const updated = await client.query<AgentDeliveryRow>(`
          UPDATE ai_phone.agent_delivery_attempts
          SET status = $2, terminal_reason = $3,
            available_at = CASE WHEN $2 = 'failed'
              THEN $4::timestamptz + make_interval(secs => LEAST(
                300, (2 ^ LEAST(delivery_attempt_number, 8))::integer
              )) ELSE available_at END,
            claim_id = NULL, claim_owner = NULL, claim_expires_at = NULL,
            ended_at = $4::timestamptz, version = version + 1,
            updated_at = $4::timestamptz
          WHERE delivery_attempt_id = $1 RETURNING *
        `, [current.deliveryAttemptId, status, reason, now.toISOString()]);
        const record = agentDeliveryFromRow(updated.rows[0]!);
        await enqueueDeliveryEvent(
          transaction,
          `delivery-converge:${record.deliveryAttemptId}:${current.version}`,
          `agent.delivery.${status}`,
          record,
          now,
        );
        records.push(record);
      }
      return records;
    });
  }

  async applyLifecycle(
    event: AgentDeliveryLifecycleEvent,
    receivedAt = new Date(),
  ) {
    const now = validWorkDate(receivedAt, "delivery_lifecycle_received_at");
    const eventTime = validWorkDate(
      new Date(event.occurredAt),
      "delivery_lifecycle_occurred_at",
    );
    if (eventTime.getTime() > now.getTime() + 30_000 ||
        eventTime.getTime() < now.getTime() - 5 * 60_000) {
      throw new AgentDeliveryRecordError("delivery_lifecycle_time_invalid");
    }
    const command = deliveryCommand({
      commandId: event.eventId,
      deliveryAttemptId: event.deliveryAttemptId,
      commandType: event.type,
      requestHash: repositoryRequestHash(event),
    });
    return this.support.transaction(async (client, transaction) => {
      await lockDelivery(client, event.deliveryAttemptId);
      const replay = await transaction
        .readCommandResult<AgentDeliveryCommandResult>(command);
      if (replay) {
        return {
          replayed: true,
          record: await requireAgentDelivery(client, event.deliveryAttemptId),
          clientLifecycleQueued: false,
        };
      }
      const current = await requireAgentDelivery(
        client,
        event.deliveryAttemptId,
        true,
      );
      assertLifecycleBinding(current, event);
      const transition = lifecycleTransition(current, event);
      if (!transition.changed) {
        await recordDeliveryCommand(transaction, command, current, now);
        return {
          replayed: true,
          record: current,
          clientLifecycleQueued: false,
        };
      }
      const updated = await client.query<AgentDeliveryRow>(`
        UPDATE ai_phone.agent_delivery_attempts
        SET status = $2, server_playback_state = $3,
          terminal_reason = COALESCE($4, terminal_reason),
          available_at = CASE WHEN $2 = 'failed'
            THEN $5::timestamptz + make_interval(secs => LEAST(
              300, (2 ^ LEAST(delivery_attempt_number, 8))::integer
            )) ELSE available_at END,
          ended_at = CASE WHEN $7 THEN COALESCE(ended_at, $6::timestamptz)
            ELSE ended_at END,
          version = version + 1, updated_at = $5::timestamptz
        WHERE delivery_attempt_id = $1 RETURNING *
      `, [
        current.deliveryAttemptId,
        transition.status,
        transition.serverPlaybackState,
        "reason" in transition ? transition.reason : null,
        now.toISOString(),
        eventTime.toISOString(),
        transition.terminal,
      ]);
      const record = agentDeliveryFromRow(updated.rows[0]!);
      await enqueueDeliveryEvent(transaction, event.eventId, event.type,
        record, eventTime);
      await enqueueAgentDeliveryClientEvent(client, event, now);
      await recordDeliveryCommand(transaction, command, record, now);
      return { replayed: false, record, clientLifecycleQueued: true };
    });
  }

  async applyClientReceipt(
    receipt: ClientPlaybackReceipt,
    receivedAt = new Date(),
  ) {
    const now = validWorkDate(receivedAt, "delivery_receipt_received_at");
    const occurredAt = validWorkDate(
      new Date(receipt.occurredAt),
      "delivery_receipt_occurred_at",
    );
    if (occurredAt.getTime() > now.getTime() + 30_000 ||
        occurredAt.getTime() < now.getTime() - 5 * 60_000) {
      throw new AgentDeliveryRecordError("delivery_receipt_time_invalid");
    }
    const receiptHash = repositoryRequestHash(receipt);
    return this.support.transaction(async (client, transaction) => {
      await lockDelivery(client, receipt.deliveryAttemptId);
      const existing = await client.query<{ receipt_hash: string }>(`
        SELECT receipt_hash FROM ai_phone.agent_delivery_receipts
        WHERE receipt_id = $1 FOR UPDATE
      `, [receipt.receiptId]);
      if (existing.rows[0]) {
        if (existing.rows[0].receipt_hash !== receiptHash) {
          throw new AgentDeliveryRecordError("playback_receipt_id_reused");
        }
        return {
          replayed: true,
          record: await requireAgentDelivery(client, receipt.deliveryAttemptId),
        };
      }
      const current = await requireAgentDelivery(
        client,
        receipt.deliveryAttemptId,
        true,
      );
      assertReceiptBinding(current, receipt);
      if (occurredAt.getTime() < Date.parse(current.createdAt) ||
          Date.parse(current.expiresAt) <= occurredAt.getTime()) {
        throw new AgentDeliveryRecordError("delivery_receipt_time_invalid");
      }
      await assertCurrentReceiptOwner(client, current, receipt, now);
      const transition = receiptTransition(current, receipt);
      await client.query(`
        INSERT INTO ai_phone.agent_delivery_receipts(
          receipt_id, delivery_attempt_id, receipt_type, receipt_hash,
          occurred_at, created_at
        ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
      `, [receipt.receiptId, receipt.deliveryAttemptId, receipt.type,
        receiptHash, occurredAt.toISOString(), now.toISOString()]);
      const updated = await client.query<AgentDeliveryRow>(`
        UPDATE ai_phone.agent_delivery_attempts
        SET status = $2,
          terminal_reason = COALESCE($3, terminal_reason),
          started_at = CASE WHEN $2 = 'playback_started'
            THEN COALESCE(started_at, $4::timestamptz) ELSE started_at END,
          ended_at = CASE WHEN $5 THEN $4::timestamptz ELSE ended_at END,
          version = version + 1, updated_at = $6::timestamptz
        WHERE delivery_attempt_id = $1 RETURNING *
      `, [current.deliveryAttemptId, transition.status,
        "reason" in transition ? transition.reason : null,
        occurredAt.toISOString(),
        transition.terminal,
        now.toISOString(),
      ]);
      const record = agentDeliveryFromRow(updated.rows[0]!);
      await enqueueDeliveryEvent(transaction, receipt.receiptId, receipt.type,
        record, occurredAt);
      return { replayed: false, record };
    });
  }

  async terminate(input: {
    deliveryAttemptId: string;
    commandId: string;
    status: "cancelled" | "failed" | "expired";
    reason: string;
    now?: Date;
  }) {
    const deliveryAttemptId = boundedWorkValue(
      input.deliveryAttemptId,
      "delivery_attempt_id",
      160,
    );
    const reason = boundedWorkValue(input.reason, "terminal_reason", 120);
    const now = validWorkDate(input.now ?? new Date(), "delivery_terminal_now");
    const command = deliveryCommand({
      commandId: input.commandId,
      deliveryAttemptId,
      commandType: `agent.delivery.${input.status}`,
      requestHash: repositoryRequestHash({ deliveryAttemptId,
        status: input.status, reason }),
    });
    return this.support.transaction(async (client, transaction) => {
      await lockDelivery(client, deliveryAttemptId);
      const replay = await transaction
        .readCommandResult<AgentDeliveryCommandResult>(command);
      if (replay) {
        return { replayed: true,
          record: await requireAgentDelivery(client, deliveryAttemptId) };
      }
      const current = await requireAgentDelivery(client, deliveryAttemptId, true);
      if (isTerminalDelivery(current.status)) {
        await recordDeliveryCommand(transaction, command, current, now);
        return { replayed: true, record: current };
      }
      const updated = await client.query<AgentDeliveryRow>(`
        UPDATE ai_phone.agent_delivery_attempts
        SET status = $2, terminal_reason = $3,
          available_at = CASE WHEN $2 = 'failed'
            THEN $4::timestamptz + make_interval(secs => LEAST(
              300, (2 ^ LEAST(delivery_attempt_number, 8))::integer
            )) ELSE available_at END,
          claim_id = NULL, claim_owner = NULL, claim_expires_at = NULL,
          ended_at = $4::timestamptz, version = version + 1,
          updated_at = $4::timestamptz
        WHERE delivery_attempt_id = $1 RETURNING *
      `, [deliveryAttemptId, input.status, reason, now.toISOString()]);
      const record = agentDeliveryFromRow(updated.rows[0]!);
      await enqueueDeliveryEvent(transaction, input.commandId,
        `agent.delivery.${input.status}`, record, now);
      await recordDeliveryCommand(transaction, command, record, now);
      return { replayed: false, record };
    });
  }
}
