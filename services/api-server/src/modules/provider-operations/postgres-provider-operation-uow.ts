import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import type {
  CommunicationProvider,
  ProviderOperationStatus,
  ProviderOperationType,
} from "@translation/contracts";
import type {
  PostgresAggregateFence,
  PostgresPrimaryTransaction,
  PrimaryCommandIdentity,
} from "../../infrastructure/storage/postgres-primary-store.js";
import type { ProviderOperationRecord } from "./provider-operation-record.js";

const aggregateType = "communication_session";
export const providerOperationTerminalStatuses = new Set<ProviderOperationStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

export function assertProviderOperationBeginInput(input: {
  sessionId: string;
  provider: string;
  operationType: string;
  operationKey?: string;
  idempotencyKey: string;
  requestHash: string;
}) {
  if (!bounded(input.sessionId, 160) || !bounded(input.provider, 80) ||
    !bounded(input.operationType, 80) ||
    (input.operationKey !== undefined && !bounded(input.operationKey, 160)) ||
    !bounded(input.idempotencyKey, 200) || !bounded(input.requestHash, 128) ||
    input.requestHash.trim().length < 16) {
    throw new Error("Invalid PostgreSQL provider operation begin input");
  }
}

export async function operationByIdempotency(
  transaction: PostgresPrimaryTransaction,
  provider: CommunicationProvider,
  operationType: ProviderOperationType,
  idempotencyKey: string,
) {
  const rows = await transaction.queryRead<IdRow>(`
    SELECT id FROM ai_phone.provider_operations
    WHERE provider = $1 AND operation_type = $2 AND idempotency_key = $3
  `, [provider, operationType, idempotencyKey]);
  return rows[0] ? readRequired(transaction, rows[0].id) : null;
}

export async function sessionOperation(
  transaction: PostgresPrimaryTransaction,
  sessionId: string,
  operationType: ProviderOperationType,
  operationKey?: string,
) {
  const rows = await transaction.queryRead<IdRow>(`
    SELECT id FROM ai_phone.provider_operations
    WHERE session_id = $1 AND operation_type = $2
      AND operation_key IS NOT DISTINCT FROM $3
  `, [sessionId, operationType, operationKey]);
  return rows[0] ? readRequired(transaction, rows[0].id) : null;
}

async function readRequired(transaction: PostgresPrimaryTransaction, id: string) {
  const record = await transaction.read<ProviderOperationRecord>("providerOperations", id);
  if (!record) throw new Error("Provider operation projection record is missing");
  return requireOperation(record.payload, id);
}

export async function recordCommand<T>(
  transaction: PostgresPrimaryTransaction,
  command: PrimaryCommandIdentity,
  result: T,
) {
  const recorded = await transaction.recordCommandResult({
    ...command,
    result,
    retainUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000).toISOString(),
  });
  return recorded.result;
}

export function beginCommand(input: {
  sessionId: string;
  provider: CommunicationProvider;
  operationType: ProviderOperationType;
  operationKey?: string;
  idempotencyKey: string;
  requestHash: string;
}): PrimaryCommandIdentity {
  const payload = {
    sessionId: input.sessionId,
    provider: input.provider,
    operationType: input.operationType,
    operationKey: input.operationKey,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
  };
  return commandIdentity(
    input.sessionId,
    "provider_operation.begin",
    `begin:${input.sessionId}:${input.provider}:${input.operationType}:` +
      `${input.idempotencyKey}:${digest(stableJson(payload))}`,
    payload,
  );
}

export function updateCommand(input: {
  fence: PostgresAggregateFence;
  commandId: string;
  operationId: string;
  status: ProviderOperationStatus;
  expectedVersion?: number;
  externalOperationId?: string;
  externalResourceId?: string;
  errorClass?: string;
  completionObservedAt?: string;
  completionObservedEvent?: string;
}): PrimaryCommandIdentity {
  if (!bounded(input.commandId, 200)) throw new Error("Invalid provider command id");
  return commandIdentity(
    input.fence.aggregateId,
    "provider_operation.update",
    `update:${input.commandId}`,
    {
      operationId: input.operationId,
      status: input.status,
      expectedVersion: input.expectedVersion,
      externalOperationId: input.externalOperationId,
      externalResourceId: input.externalResourceId,
      errorClass: input.errorClass,
      completionObservedAt: input.completionObservedAt,
      completionObservedEvent: input.completionObservedEvent,
    },
  );
}

function commandIdentity(
  sessionId: string,
  commandType: string,
  key: string,
  payload: unknown,
): PrimaryCommandIdentity {
  return {
    commandId: `cmd_${digest(key)}`,
    aggregateType,
    aggregateId: sessionId,
    commandType,
    requestHash: digest(stableJson(payload)),
  };
}

export function nextOperation(
  operation: ProviderOperationRecord,
  input: {
    status: ProviderOperationStatus;
    externalOperationId?: string;
    externalResourceId?: string;
    errorClass?: string;
    completionObservedAt?: string;
    completionObservedEvent?: string;
    now?: Date;
  },
) {
  const updatedAt = (input.now ?? new Date()).toISOString();
  const next = {
    ...operation,
    status: input.status,
    version: operation.version + 1,
    updatedAt,
    externalOperationId: input.externalOperationId ?? operation.externalOperationId,
    externalResourceId: input.externalResourceId ?? operation.externalResourceId,
    lastErrorClass: input.errorClass?.slice(0, 80) ?? operation.lastErrorClass,
    completionObservedAt: input.completionObservedAt ?? operation.completionObservedAt,
    completionObservedEvent: input.completionObservedEvent ??
      operation.completionObservedEvent,
  };
  if (input.status === "accepted") next.acceptedAt ??= updatedAt;
  if (input.status === "active") next.answeredAt ??= updatedAt;
  if (providerOperationTerminalStatuses.has(input.status)) next.endedAt ??= updatedAt;
  return next;
}

export async function enqueueChanged(
  transaction: PostgresPrimaryTransaction,
  eventId: string,
  operation: ProviderOperationRecord,
  eventType: string,
) {
  await transaction.enqueueOutbox({
    id: eventId,
    idempotencyKey: eventId,
    sessionId: operation.sessionId,
    aggregateVersion: operation.version,
    sequence: operation.version,
    eventType,
    eventVersion: 1,
    payload: { operation },
  });
}

export function requireOperation(value: unknown, id: string): ProviderOperationRecord {
  const operation = value as Partial<ProviderOperationRecord> | null;
  if (!operation || operation.id !== id || typeof operation.sessionId !== "string" ||
    typeof operation.version !== "number" || !Number.isSafeInteger(operation.version) ||
    !operation.status || !operation.provider || !operation.operationType) {
    throw new Error("Invalid PostgreSQL provider operation record");
  }
  return operation as ProviderOperationRecord;
}

export function assertSessionFence(fence: PostgresAggregateFence, sessionId: string) {
  if (fence.aggregateType !== aggregateType || fence.aggregateId !== sessionId) {
    throw new Error("Provider operation requires a communication session fence");
  }
}

export function externalIdsMatch(
  operation: ProviderOperationRecord,
  input: { externalOperationId?: string; externalResourceId?: string },
) {
  return (!operation.externalOperationId || !input.externalOperationId ||
      operation.externalOperationId === input.externalOperationId) &&
    (!operation.externalResourceId || !input.externalResourceId ||
      operation.externalResourceId === input.externalResourceId);
}

export function canTransition(
  current: ProviderOperationStatus,
  next: ProviderOperationStatus,
) {
  if (current === next) return true;
  if (current === "in_flight") {
    return ["accepted", "unknown", "active", "failed", "cancelled"].includes(next);
  }
  if (current === "unknown") {
    return ["accepted", "active", "succeeded", "failed"].includes(next);
  }
  if (current === "accepted") {
    return ["active", "succeeded", "failed", "unknown"].includes(next);
  }
  return current === "active" && ["succeeded", "failed"].includes(next);
}

export function providerOperationId(
  sessionId: string,
  operationType: ProviderOperationType,
  operationKey?: string,
) {
  return `op_${digest(`${operationType}:${sessionId}${operationKey ? `:${operationKey}` : ""}`)
    .slice(0, 32)}`;
}

export function mutationEventId(commandId: string) {
  return `event_${digest(commandId)}`;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, item]) => `${JSON.stringify(name)}:${stableJson(item)}`).join(",")}}`;
}

function bounded(value: string, maximum: number) {
  return value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
}

interface IdRow extends QueryResultRow {
  id: string;
}
