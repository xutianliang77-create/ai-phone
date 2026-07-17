import { createHash } from "node:crypto";
import type {
  PostgresAggregateFence,
  PostgresPrimaryTransaction,
  PrimaryCommandIdentity,
} from "./postgres-primary-store.js";

const commandRetentionMs = 90 * 24 * 60 * 60 * 1_000;

export function domainCommand(
  fence: PostgresAggregateFence,
  input: { commandId: string; commandType: string; requestHash: string },
): PrimaryCommandIdentity {
  if (!bounded(input.commandId, 200) || !bounded(input.commandType, 100) ||
    !bounded(input.requestHash, 128) || input.requestHash.trim().length < 16) {
    throw new Error("Invalid PostgreSQL domain command identity");
  }
  return {
    commandId: input.commandId,
    aggregateType: fence.aggregateType,
    aggregateId: fence.aggregateId,
    commandType: input.commandType,
    requestHash: input.requestHash,
  };
}

export function assertDomainFence(
  fence: PostgresAggregateFence,
  aggregateType: string,
  aggregateId: string,
) {
  if (fence.aggregateType !== aggregateType || fence.aggregateId !== aggregateId) {
    throw new Error(`Domain mutation requires a ${aggregateType} fence`);
  }
}

export async function recordDomainCommand<T>(
  transaction: PostgresPrimaryTransaction,
  command: PrimaryCommandIdentity,
  result: T,
) {
  const recorded = await transaction.recordCommandResult({
    ...command,
    result,
    retainUntil: new Date(Date.now() + commandRetentionMs).toISOString(),
  });
  return recorded.result;
}

export async function enqueueDomainEvent(
  transaction: PostgresPrimaryTransaction,
  input: {
    eventId: string;
    eventType: string;
    aggregateVersion: number;
    payload: unknown;
    sessionId?: string;
  },
) {
  await transaction.enqueueOutbox({
    id: input.eventId,
    idempotencyKey: input.eventId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    aggregateVersion: input.aggregateVersion,
    sequence: input.aggregateVersion,
    eventType: input.eventType,
    eventVersion: 1,
    payload: input.payload,
  });
}

export function domainEventId(commandId: string, suffix: string) {
  return `event_${createHash("sha256")
    .update(`${commandId}:${suffix}`).digest("hex")}`;
}

export function stableDomainId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

export function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function bounded(value: string, maximum: number) {
  return value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
}
