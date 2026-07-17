import type { Pool, QueryResultRow } from "pg";
import type {
  CommunicationProvider,
  ProviderOperationStatus,
  ProviderOperationType,
} from "@translation/contracts";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import type { ProviderOperationRecord } from "./provider-operation-record.js";
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
  nextOperation,
  operationByIdempotency,
  providerOperationId,
  providerOperationTerminalStatuses,
  recordCommand,
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

export class PostgresProviderOperationsRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async begin(input: {
    sessionId: string;
    provider: CommunicationProvider;
    operationType: ProviderOperationType;
    operationKey?: string;
    idempotencyKey: string;
    requestHash: string;
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
          return {
            status: replay.status === "started" ? "replayed" as const : replay.status,
            operation: current
              ? requireOperation(current.payload, replay.operation.id)
              : replay.operation,
          };
        }
        const sameKey = await operationByIdempotency(
          transaction,
          input.provider,
          input.operationType,
          input.idempotencyKey,
        );
        if (sameKey) {
          return recordCommand(transaction, command, {
            status: sameKey.requestHash === input.requestHash &&
                sameKey.sessionId === input.sessionId &&
                sameKey.operationKey === input.operationKey
              ? "replayed" : "payload_conflict",
            operation: sameKey,
          });
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

  find(operationId: string) {
    return this.primary.read<ProviderOperationRecord>("providerOperations", operationId)
      .then((record) => record ? requireOperation(record.payload, operationId) : null);
  }

  async findSession(
    sessionId: string,
    operationType: ProviderOperationType,
    operationKey?: string,
  ) {
    const ids = await this.queryIds(`
      SELECT id FROM ai_phone.provider_operations
      WHERE session_id = $1 AND operation_type = $2
        AND operation_key IS NOT DISTINCT FROM $3
    `, [sessionId, operationType, operationKey]);
    return ids[0] ? this.readExisting(ids[0]) : null;
  }

  async findActive(operationType: ProviderOperationType) {
    const ids = await this.queryIds(`
      SELECT id FROM ai_phone.provider_operations
      WHERE operation_type = $1
        AND status = ANY($2::text[])
      ORDER BY updated_at, id
    `, [operationType, ["in_flight", "accepted", "unknown", "active"]]);
    return Promise.all(ids.map((id) => this.readExisting(id)));
  }

  private async readExisting(operationId: string) {
    const operation = await this.find(operationId);
    if (!operation) {
      throw new Error("Normalized provider operation is missing its primary record");
    }
    return operation;
  }

  private async queryIds(sql: string, values: unknown[]) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<IdRow>(sql, values);
      return result.rows.map((row) => row.id);
    } finally {
      client.release();
    }
  }
}

interface IdRow extends QueryResultRow {
  id: string;
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "23505");
}
