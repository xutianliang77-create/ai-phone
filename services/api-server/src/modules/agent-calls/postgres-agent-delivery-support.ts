import type { PoolClient } from "pg";
import { domainEventId } from
  "../../infrastructure/storage/postgres-domain-record-uow.js";
import type {
  PostgresPrimaryTransaction,
  PrimaryCommandIdentity,
} from "../../infrastructure/storage/postgres-primary-store.js";
import type { AgentDeliveryRecord } from "./agent-delivery-record.js";
import {
  agentDeliveryFromRow,
  AgentDeliveryRecordError,
  type AgentDeliveryRow,
} from "./agent-delivery-record.js";
import { boundedWorkValue, lockWork } from "./postgres-agent-work-support.js";

const commandRetentionMs = 90 * 24 * 60 * 60 * 1_000;

export interface AgentDeliveryCommandResult {
  deliveryAttemptId: string;
  status: string;
  version: number;
}

export function deliveryCommand(input: {
  commandId: string;
  deliveryAttemptId: string;
  commandType: string;
  requestHash: string;
}): PrimaryCommandIdentity {
  return {
    commandId: boundedWorkValue(input.commandId, "command_id", 200),
    aggregateType: "agent_delivery",
    aggregateId:
      boundedWorkValue(input.deliveryAttemptId, "delivery_attempt_id", 160),
    commandType: input.commandType,
    requestHash: input.requestHash,
  };
}

export function lockDelivery(
  client: Pick<PoolClient, "query">,
  deliveryAttemptId: string,
) {
  return lockWork(client, `agent-delivery:${deliveryAttemptId}`);
}

export async function requireAgentDelivery(
  client: Pick<PoolClient, "query">,
  deliveryAttemptId: string,
  forUpdate = false,
) {
  const result = await client.query<AgentDeliveryRow>(`
    SELECT * FROM ai_phone.agent_delivery_attempts
    WHERE delivery_attempt_id = $1 ${forUpdate ? "FOR UPDATE" : ""}
  `, [deliveryAttemptId]);
  if (!result.rows[0]) {
    throw new AgentDeliveryRecordError("delivery_not_found");
  }
  return agentDeliveryFromRow(result.rows[0]);
}

export function recordDeliveryCommand(
  transaction: PostgresPrimaryTransaction,
  command: PrimaryCommandIdentity,
  record: AgentDeliveryRecord,
  now: Date,
) {
  return transaction.recordCommandResult({
    ...command,
    result: {
      deliveryAttemptId: record.deliveryAttemptId,
      status: record.status,
      version: record.version,
    } satisfies AgentDeliveryCommandResult,
    retainUntil: new Date(now.getTime() + commandRetentionMs).toISOString(),
  });
}

export function enqueueDeliveryEvent(
  transaction: PostgresPrimaryTransaction,
  eventIdentity: string,
  eventType: string,
  record: AgentDeliveryRecord,
  now: Date,
) {
  const eventId = domainEventId(eventIdentity, eventType);
  return transaction.enqueueOutbox({
    id: eventId,
    idempotencyKey: eventId,
    sessionId: record.sessionId,
    aggregateVersion: record.version,
    sequence: record.version,
    eventType,
    eventVersion: 1,
    payload: {
      deliveryAttemptId: record.deliveryAttemptId,
      workId: record.workId,
      sessionId: record.sessionId,
      legId: record.legId,
      turnId: record.turnId,
      turnGeneration: record.turnGeneration,
      dispatchGeneration: record.dispatchGeneration,
      clientInstanceId: record.clientInstanceId,
      clientParticipantIdentity: record.clientParticipantIdentity,
      workerParticipantIdentity: record.workerParticipantIdentity,
      ownershipGeneration: record.ownershipGeneration,
      playbackId: record.playbackId,
      playbackGeneration: record.playbackGeneration,
      status: record.status,
      serverPlaybackState: record.serverPlaybackState,
      version: record.version,
      occurredAt: now.toISOString(),
      ...(record.terminalReason
        ? { terminalReason: record.terminalReason }
        : {}),
    },
  });
}

export function assertDeliveryClaim(
  record: AgentDeliveryRecord,
  input: { claimId: string; owner: string; now: Date },
) {
  if (record.status !== "claimed" || !record.claim ||
      record.claim.claimId !== input.claimId ||
      record.claim.claimantId !== input.owner ||
      Date.parse(record.claim.expiresAt) <= input.now.getTime()) {
    throw new AgentDeliveryRecordError("delivery_claim_invalid");
  }
}

export function assertDeliveryActiveScope(
  record: AgentDeliveryRecord,
  input: {
    turnId: string;
    turnGeneration: number;
    dispatchGeneration: number;
    clientInstanceId: string;
    clientParticipantIdentity: string;
    workerParticipantIdentity: string;
    ownershipLeaseId: string;
    ownershipGeneration: number;
  },
) {
  if (record.turnId !== input.turnId ||
      record.turnGeneration !== input.turnGeneration ||
      record.dispatchGeneration !== input.dispatchGeneration ||
      record.clientInstanceId !== input.clientInstanceId ||
      record.clientParticipantIdentity !== input.clientParticipantIdentity ||
      record.workerParticipantIdentity !== input.workerParticipantIdentity ||
      record.ownershipLeaseId !== input.ownershipLeaseId ||
      record.ownershipGeneration !== input.ownershipGeneration) {
    throw new AgentDeliveryRecordError("delivery_scope_stale");
  }
}
