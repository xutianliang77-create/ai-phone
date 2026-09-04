import type { Pool } from "pg";
import type {
  CommunicationProvider,
  ProviderOperationStatus,
  ProviderOperationType,
} from "@translation/contracts";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import type { ProviderOperationOutboxFactory, ProviderOperationRecord } from
  "./provider-operation-record.js";
import { enqueueProviderOperationOutbox } from
  "./postgres-provider-operation-outbox.js";
import { PostgresProviderOperationQueries } from
  "./postgres-provider-operation-queries.js";
import { currentPlatformTraceId } from
  "../../infrastructure/observability/platform-telemetry.js";
import {
  assertProviderOperationBeginInput,
  assertSessionFence,
  beginCommand,
  canTransition,
  enqueueChanged,
  externalIdsMatch,
  mutationEventId,
  nextOperation, nextRetriedOperation,
  operationByIdempotency,
  providerOperationId,
  providerOperationTerminalStatuses,
  recordCommand, retryCommand,
  requireOperation,
  sessionOperation,
  updateCommand,
} from "./postgres-provider-operation-uow.js";

type BeginResult = {
  status: "started" | "replayed" | "payload_conflict" | "session_conflict";
  operation: ProviderOperationRecord;
};

type UpdateResult = {
  status: "not_found";
} | {
  status: "version_conflict" | "external_id_conflict" | "terminal" |
    "invalid_transition" | "updated";
  operation: ProviderOperationRecord;
};

type RetryResult = { status: "not_found" } | {
  status: "version_conflict" | "invalid_state" | "retried";
  operation: ProviderOperationRecord;
};

export class PostgresProviderOperationsRepository {
  private readonly primary: PostgresPrimaryStore;
  private readonly queries: PostgresProviderOperationQueries;

  constructor(pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
    this.queries = new PostgresProviderOperationQueries(pool);
  }

  async begin(input: {
    sessionId: string;
    provider: CommunicationProvider;
    operationType: ProviderOperationType;
    operationKey?: string;
    idempotencyKey: string;
    requestHash: string;
    outboxFactory?: ProviderOperationOutboxFactory;
    fence: PostgresAggregateFence;
    now?: Date;
  }): Promise<BeginResult> {
    assertProviderOperationBeginInput(input);
    assertSessionFence(input.fence, input.sessionId);
    const command = beginCommand(input);
    const execute = () => this.primary.withAggregateTransaction<BeginResult>(
      input.fence,
      async (transaction) => {
        const replay = await transaction.readCommandResult<BeginResult>(command);
        if (replay) {
          const current = await transaction.read<ProviderOperationRecord>(
            "providerOperations",
            replay.operation.id,
          );
          const result = {
            status: replay.status === "started" ? "replayed" as const : replay.status,
            operation: current
              ? requireOperation(current.payload, replay.operation.id)
              : replay.operation,
          };
          if (result.status === "replayed") {
            await enqueueProviderOperationOutbox(
              transaction,
              input.outboxFactory,
              result.operation,
            );
          }
          return result;
        }
        const sameKey = await operationByIdempotency(
          transaction,
          input.provider,
          input.operationType,
          input.idempotencyKey,
        );
        if (sameKey) {
          const result = {
            status: sameKey.requestHash === input.requestHash &&
                sameKey.sessionId === input.sessionId &&
                sameKey.operationKey === input.operationKey
              ? "replayed" as const : "payload_conflict" as const,
            operation: sameKey,
          };
          if (result.status === "replayed") {
            await enqueueProviderOperationOutbox(
              transaction,
              input.outboxFactory,
              result.operation,
            );
          }
          return recordCommand(transaction, command, result);
        }
        const sameSession = await sessionOperation(
          transaction,
          input.sessionId,
          input.operationType,
          input.operationKey,
        );
        if (sameSession) {
          return recordCommand(transaction, command, {
            status: "session_conflict",
            operation: sameSession,
          });
        }
        const timestamp = (input.now ?? new Date()).toISOString();
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
          startedAt: timestamp,
          updatedAt: timestamp,
          ...(traceId ? { traceId } : {}),
        };
        const eventId = mutationEventId(command.commandId);
        const stored = await transaction.mutate<ProviderOperationRecord>({
          eventId,
          namespace: "providerOperations",
          recordKey: operation.id,
          operation: "upsert",
          payload: operation,
          expectedRecordVersion: null,
        });
        const saved = requireOperation(stored?.payload, operation.id);
        await enqueueChanged(transaction, eventId, saved, "provider_operation.started");
        await enqueueProviderOperationOutbox(transaction, input.outboxFactory, saved);
        return recordCommand(transaction, command, {
          status: "started",
          operation: saved,
        });
      },
    );
    try {
      return await execute();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return execute();
    }
  }

  async update(input: {
    operationId: string;
    commandId: string;
    status: ProviderOperationStatus;
    fence: PostgresAggregateFence;
    expectedVersion?: number;
    externalOperationId?: string;
    externalResourceId?: string;
    errorClass?: string;
    completionObservedAt?: string;
    completionObservedEvent?: string;
    now?: Date;
  }): Promise<UpdateResult> {
    assertSessionFence(input.fence, input.fence.aggregateId);
    const command = updateCommand(input);
    return this.primary.withAggregateTransaction<UpdateResult>(
      input.fence,
      async (transaction) => {
        const replay = await transaction.readCommandResult<UpdateResult>(command);
        if (replay) return replay;
        const current = await transaction.read<ProviderOperationRecord>(
          "providerOperations",
          input.operationId,
        );
        if (!current) {
          return recordCommand(transaction, command, { status: "not_found" });
        }
        const operation = requireOperation(current.payload, input.operationId);
        if (operation.sessionId !== input.fence.aggregateId) {
          throw new Error("Provider operation is outside the fenced session");
        }
        if (input.expectedVersion !== undefined &&
          input.expectedVersion !== operation.version) {
          return recordCommand(transaction, command, {
            status: "version_conflict",
            operation,
          });
        }
        if (!externalIdsMatch(operation, input)) {
          return recordCommand(transaction, command, {
            status: "external_id_conflict",
            operation,
          });
        }
        if (providerOperationTerminalStatuses.has(operation.status)) {
          return recordCommand(transaction, command, { status: "terminal", operation });
        }
        if (!canTransition(operation.status, input.status)) {
          return recordCommand(transaction, command, {
            status: "invalid_transition",
            operation,
          });
        }
        const next = nextOperation(operation, input);
        const eventId = mutationEventId(command.commandId);
        const stored = await transaction.mutate<ProviderOperationRecord>({
          eventId,
          namespace: "providerOperations",
          recordKey: operation.id,
          operation: "upsert",
          payload: next,
          expectedRecordVersion: current.recordVersion,
        });
        const saved = requireOperation(stored?.payload, operation.id);
        await enqueueChanged(transaction, eventId, saved, "provider_operation.updated");
        return recordCommand(transaction, command, {
          status: "updated",
          operation: saved,
        });
      },
    );
  }

  async retry(input: {
    operationId: string;
    commandId: string;
    expectedVersion: number;
    fence: PostgresAggregateFence;
    now?: Date;
  }): Promise<RetryResult> {
    assertSessionFence(input.fence, input.fence.aggregateId);
    const command = retryCommand(input);
    return this.primary.withAggregateTransaction<RetryResult>(
      input.fence,
      async (transaction) => {
        const replay = await transaction.readCommandResult<RetryResult>(command);
        if (replay) return replay;
        const current = await transaction.read<ProviderOperationRecord>(
          "providerOperations",
          input.operationId,
        );
        if (!current) {
          return recordCommand(transaction, command, { status: "not_found" });
        }
        const operation = requireOperation(current.payload, input.operationId);
        if (operation.sessionId !== input.fence.aggregateId) {
          throw new Error("Provider operation is outside the fenced session");
        }
        if (operation.version !== input.expectedVersion) {
          return recordCommand(transaction, command, {
            status: "version_conflict",
            operation,
          });
        }
        if (operation.status !== "failed" ||
          !["phone_hangup", "phone_dtmf"].includes(operation.operationType) ||
          operation.lastErrorClass !== "unavailable") {
          return recordCommand(transaction, command, {
            status: "invalid_state",
            operation,
          });
        }
        const next = nextRetriedOperation(operation, input.now);
        const eventId = mutationEventId(command.commandId);
        const stored = await transaction.mutate<ProviderOperationRecord>({
          eventId,
          namespace: "providerOperations",
          recordKey: operation.id,
          operation: "upsert",
          payload: next,
          expectedRecordVersion: current.recordVersion,
        });
        const saved = requireOperation(stored?.payload, operation.id);
        await enqueueChanged(
          transaction,
          eventId,
          saved,
          "provider_operation.retried",
        );
        return recordCommand(transaction, command, {
          status: "retried",
          operation: saved,
        });
      },
    );
  }

  find(operationId: string) {
    return this.queries.find(operationId);
  }

  async findIdempotency(
    provider: CommunicationProvider,
    operationType: ProviderOperationType,
    idempotencyKey: string,
  ) {
    return this.queries.findIdempotency(provider, operationType, idempotencyKey);
  }

  async findSession(
    sessionId: string,
    operationType: ProviderOperationType,
    operationKey?: string,
  ) {
    return this.queries.findSession(sessionId, operationType, operationKey);
  }

  async findActive(operationType: ProviderOperationType) {
    return this.queries.findActive(operationType);
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "23505");
}
