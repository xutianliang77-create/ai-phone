import { createHash } from "node:crypto";
import type {
  CommunicationProvider,
  ProviderOperationStatus,
  ProviderOperationType,
} from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import { StorageConflictError } from "../../infrastructure/storage/sqlite-snapshot-store.js";
import type { ProviderOperationRecord } from "./provider-operation-record.js";
import { currentPlatformTraceId } from "../../infrastructure/observability/platform-telemetry.js";

const terminalStatuses = new Set<ProviderOperationStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

export function beginProviderOperation(input: {
  sessionId: string;
  provider: CommunicationProvider;
  operationType: ProviderOperationType;
  operationKey?: string;
  idempotencyKey: string;
  requestHash: string;
  now?: Date;
}) {
  try {
    return beginProviderOperationTransaction(input);
  } catch (error) {
    if (!(error instanceof StorageConflictError)) throw error;
    return beginProviderOperationTransaction(input);
  }
}

function beginProviderOperationTransaction(input: {
  sessionId: string;
  provider: CommunicationProvider;
  operationType: ProviderOperationType;
  operationKey?: string;
  idempotencyKey: string;
  requestHash: string;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const store = getStoreSnapshot();
    const sameKey = store.providerOperations.find((operation) =>
      operation.provider === input.provider &&
      operation.operationType === input.operationType &&
      operation.idempotencyKey === input.idempotencyKey
    );
    if (sameKey) {
      return sameKey.requestHash === input.requestHash
        ? { status: "replayed" as const, operation: sameKey }
        : { status: "payload_conflict" as const, operation: sameKey };
    }
    const sessionOperation = store.providerOperations.find((operation) =>
      operation.sessionId === input.sessionId &&
      operation.operationType === input.operationType &&
      operation.operationKey === input.operationKey
    );
    if (sessionOperation) {
      return { status: "session_conflict" as const, operation: sessionOperation };
    }

    const now = (input.now ?? new Date()).toISOString();
    const traceId = currentPlatformTraceId();
    const operation: ProviderOperationRecord = {
      id: providerOperationId(
        input.sessionId,
        input.operationType,
        input.operationKey,
      ),
      sessionId: input.sessionId,
      provider: input.provider,
      operationType: input.operationType,
      ...(input.operationKey ? { operationKey: input.operationKey } : {}),
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      status: "in_flight",
      attempt: 1,
      version: 1,
      startedAt: now,
      updatedAt: now,
      ...(traceId ? { traceId } : {}),
    };
    store.providerOperations.push(operation);
    persistStoreSnapshot();
    return { status: "started" as const, operation };
  });
}

export function updateProviderOperation(input: {
  operationId: string;
  status: ProviderOperationStatus;
  expectedVersion?: number;
  externalOperationId?: string;
  externalResourceId?: string;
  errorClass?: string;
  completionObservedAt?: string;
  completionObservedEvent?: string;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const operation = findProviderOperation(input.operationId);
    if (!operation) return { status: "not_found" as const };
    if (input.expectedVersion !== undefined &&
      operation.version !== input.expectedVersion) {
      return { status: "version_conflict" as const, operation };
    }
    if (!externalIdsMatch(operation, input)) {
      return { status: "external_id_conflict" as const, operation };
    }
    if (terminalStatuses.has(operation.status)) {
      return { status: "terminal" as const, operation };
    }
    if (!canTransition(operation.status, input.status)) {
      return { status: "invalid_transition" as const, operation };
    }

    const now = input.now ?? new Date();
    operation.status = input.status;
    operation.version += 1;
    operation.updatedAt = now.toISOString();
    operation.externalOperationId = input.externalOperationId ??
      operation.externalOperationId;
    operation.externalResourceId = input.externalResourceId ??
      operation.externalResourceId;
    if (input.errorClass) operation.lastErrorClass = input.errorClass.slice(0, 80);
    operation.completionObservedAt = input.completionObservedAt ??
      operation.completionObservedAt;
    operation.completionObservedEvent = input.completionObservedEvent ??
      operation.completionObservedEvent;
    if (input.status === "accepted") operation.acceptedAt ??= operation.updatedAt;
    if (input.status === "active") operation.answeredAt ??= operation.updatedAt;
    if (terminalStatuses.has(input.status)) operation.endedAt ??= operation.updatedAt;
    persistStoreSnapshot();
    return { status: "updated" as const, operation };
  });
}

function providerOperationId(
  sessionId: string,
  operationType: ProviderOperationType,
  operationKey?: string,
) {
  const digest = createHash("sha256")
    .update(`${operationType}:${sessionId}${operationKey ? `:${operationKey}` : ""}`)
    .digest("hex")
    .slice(0, 32);
  return `op_${digest}`;
}

export function findProviderOperation(operationId: string) {
  return getStoreSnapshot().providerOperations.find(
    (operation) => operation.id === operationId,
  ) ?? null;
}

export function findSessionProviderOperation(
  sessionId: string,
  operationType: ProviderOperationType,
  operationKey?: string,
) {
  return getStoreSnapshot().providerOperations.find((operation) =>
    operation.sessionId === sessionId &&
    operation.operationType === operationType &&
    operation.operationKey === operationKey
  ) ?? null;
}

export function findActiveProviderOperations(operationType: ProviderOperationType) {
  return getStoreSnapshot().providerOperations.filter((operation) =>
    operation.operationType === operationType && !terminalStatuses.has(operation.status)
  );
}

function externalIdsMatch(
  operation: ProviderOperationRecord,
  input: { externalOperationId?: string; externalResourceId?: string },
) {
  return (!operation.externalOperationId || !input.externalOperationId ||
      operation.externalOperationId === input.externalOperationId) &&
    (!operation.externalResourceId || !input.externalResourceId ||
      operation.externalResourceId === input.externalResourceId);
}

function canTransition(
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
