import type { Pool, QueryResultRow } from "pg";
import type { AgentCallRecord } from "./agent-call-record.js";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  assertDomainFence,
  domainCommand,
  domainEventId,
  enqueueDomainEvent,
  recordDomainCommand,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";
import {
  hydrateAgentTask,
  requireAgentTaskPrimary,
  toAgentTaskPrimary,
  type AgentTaskPrimaryRecord,
} from "./postgres-agent-task-uow.js";

type MutationStatus = "created" | "updated" | "noop" | "not_found" |
  "owner_conflict" | "version_conflict" | "id_conflict";

export class PostgresAgentTasksRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async create(input: {
    record: AgentCallRecord;
    idempotencyKey: string;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
  }) {
    assertDomainFence(input.fence, "agent_task", input.record.id);
    const requested = toAgentTaskPrimary(input.record, {
      version: 1,
      requestHash: input.requestHash,
      idempotencyKey: input.idempotencyKey,
    });
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "agent.task.create",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<TaskCommandResult>(command);
      if (replay) {
        const record = await transaction.read<AgentTaskPrimaryRecord>(
          "agentCallDrafts", requested.id,
        );
        return record
          ? { status: replay.status, task: hydrateAgentTask(record.payload, requested.id) }
          : { status: "not_found" as const };
      }
      const current = await transaction.read<AgentTaskPrimaryRecord>(
        "agentCallDrafts", requested.id,
      );
      if (current) {
        const task = requireAgentTaskPrimary(current.payload, requested.id);
        const status = task.requestHash === requested.requestHash
          ? "noop" : "id_conflict";
        await recordDomainCommand(transaction, command, taskResult(status, task));
        return { status, task: hydrateAgentTask(task, task.id) };
      }
      const eventId = domainEventId(input.commandId, "agent:task:create");
      const stored = await transaction.mutate<AgentTaskPrimaryRecord>({
        eventId,
        namespace: "agentCallDrafts",
        recordKey: requested.id,
        operation: "upsert",
        payload: requested,
        expectedRecordVersion: null,
      });
      const task = requireAgentTaskPrimary(stored?.payload, requested.id);
      await enqueueDomainEvent(transaction, {
        eventId,
        eventType: "agent.task.created",
        aggregateVersion: task.version,
        payload: { task },
      });
      await recordDomainCommand(transaction, command, taskResult("created", task));
      return { status: "created" as const, task: hydrateAgentTask(task, task.id) };
    });
  }

  async update(input: {
    taskId: string;
    userId?: string;
    bindSessionId?: string;
    expectedVersion?: number;
    commandId: string;
    commandType: string;
    requestHash: string;
    eventType: string;
    fence: PostgresAggregateFence;
    mutate: (current: AgentCallRecord) => AgentCallRecord | null;
  }) {
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: input.commandType,
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<TaskCommandResult>(command);
      if (replay) {
        const record = await transaction.read<AgentTaskPrimaryRecord>(
          "agentCallDrafts", input.taskId,
        );
        return record
          ? { status: replay.status, task: hydrateAgentTask(record.payload, input.taskId) }
          : { status: "not_found" as const };
      }
      const primary = await transaction.read<AgentTaskPrimaryRecord>(
        "agentCallDrafts", input.taskId,
      );
      if (!primary) {
        await recordDomainCommand(transaction, command, {
          status: "not_found", taskId: input.taskId, version: 0,
        });
        return { status: "not_found" as const };
      }
      const stored = requireAgentTaskPrimary(primary.payload, input.taskId);
      assertTaskFence(input.fence, stored, input.bindSessionId);
      if (input.userId && stored.userId !== input.userId) {
        await recordDomainCommand(transaction, command, taskResult("owner_conflict", stored));
        return { status: "owner_conflict" as const };
      }
      if (input.expectedVersion !== undefined && stored.version !== input.expectedVersion) {
        await recordDomainCommand(transaction, command, taskResult("version_conflict", stored));
        return {
          status: "version_conflict" as const,
          task: hydrateAgentTask(stored, stored.id),
        };
      }
      const current = hydrateAgentTask(stored, stored.id);
      const candidate = input.mutate(structuredClone(current));
      if (!candidate) {
        await recordDomainCommand(transaction, command, taskResult("noop", stored));
        return { status: "noop" as const, task: current };
      }
      assertImmutableTaskIdentity(current, candidate);
      const next = toAgentTaskPrimary(candidate, {
        version: stored.version + 1,
        requestHash: input.requestHash,
        idempotencyKey: stored.idempotencyKey,
      });
      const eventId = domainEventId(input.commandId, "agent:task:update");
      const saved = await transaction.mutate<AgentTaskPrimaryRecord>({
        eventId,
        namespace: "agentCallDrafts",
        recordKey: input.taskId,
        operation: "upsert",
        payload: next,
        expectedRecordVersion: primary.recordVersion,
      });
      const task = requireAgentTaskPrimary(saved?.payload, input.taskId);
      await enqueueDomainEvent(transaction, {
        eventId,
        eventType: input.eventType,
        aggregateVersion: task.version,
        ...(task.callId ? { sessionId: task.callId } : {}),
        payload: { task },
      });
      await recordDomainCommand(transaction, command, taskResult("updated", task));
      return { status: "updated" as const, task: hydrateAgentTask(task, task.id) };
    });
  }

  find(taskId: string) {
    return this.primary.read<AgentTaskPrimaryRecord>("agentCallDrafts", taskId)
      .then((record) => record ? hydrateAgentTask(record.payload, taskId) : null);
  }

  async findOwned(userId: string, taskId: string) {
    const task = await this.find(taskId);
    return task?.userId === userId ? task : null;
  }

  listOwned(userId: string, limit = 200) {
    return this.queryTasks(`
      WHERE task.user_id = $1
      ORDER BY task.updated_at DESC, task.id DESC LIMIT $2
    `, [userId, boundedLimit(limit, 500)]);
  }

  listQueued(limit = 20) {
    return this.queryTasks(`
      WHERE task.status = 'queued'
      ORDER BY task.queued_at, task.id LIMIT $1
    `, [boundedLimit(limit, 20)]);
  }

  listExpiredLeases(now: Date, limit = 100) {
    return this.queryTasks(`
      WHERE task.status = 'dispatching'
        AND task.worker_lease_expires_at <= $1::timestamptz
      ORDER BY task.worker_lease_expires_at, task.id LIMIT $2
    `, [now.toISOString(), boundedLimit(limit, 500)]);
  }

  listExpiredReconciliations(cutoff: Date, limit = 100) {
    return this.queryTasks(`
      WHERE task.status = 'reconciliation_required'
        AND task.updated_at <= $1::timestamptz
      ORDER BY task.updated_at, task.id LIMIT $2
    `, [cutoff.toISOString(), boundedLimit(limit, 500)]);
  }

  async findByCallReference(input: {
    userId?: string;
    callId?: string;
    providerCallId?: string;
  }) {
    const values = [input.callId ?? null, input.providerCallId ?? null,
      input.userId ?? null];
    const tasks = await this.queryTasks(`
      WHERE (($1::text IS NOT NULL AND task.call_id = $1)
        OR ($2::text IS NOT NULL AND task.external_call_id = $2))
        AND ($3::text IS NULL OR task.user_id = $3)
      ORDER BY task.updated_at DESC, task.id DESC LIMIT 20
    `, values);
    return tasks[0] ?? null;
  }

  private async queryTasks(where: string, values: unknown[]) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<TaskRow>(`
        SELECT task.id, primary_record.payload
        FROM ai_phone.agent_tasks AS task
        JOIN ai_phone.projection_records AS primary_record
          ON primary_record.namespace = 'agentCallDrafts'
          AND primary_record.record_key = task.id
        ${where}
      `, values);
      return result.rows.map((row) => hydrateAgentTask(row.payload, row.id));
    } finally {
      client.release();
    }
  }

}

function taskResult(status: MutationStatus, task: AgentTaskPrimaryRecord) {
  return { status, taskId: task.id, version: task.version };
}

function assertTaskFence(
  fence: PostgresAggregateFence,
  task: AgentTaskPrimaryRecord,
  bindSessionId?: string,
) {
  const sessionId = task.callId ?? bindSessionId;
  assertDomainFence(fence, sessionId ? "communication_session" : "agent_task",
    sessionId ?? task.id);
}

function assertImmutableTaskIdentity(current: AgentCallRecord, next: AgentCallRecord) {
  if (next.id !== current.id || next.userId !== current.userId ||
    (current.callId && next.callId !== current.callId)) {
    throw new Error("PostgreSQL Agent task identity changed");
  }
}

function boundedLimit(value: number, maximum: number) {
  return Number.isInteger(value) ? Math.max(1, Math.min(value, maximum)) : 20;
}

interface TaskCommandResult {
  status: MutationStatus;
  taskId: string;
  version: number;
}

interface TaskRow extends QueryResultRow {
  id: string;
  payload: unknown;
}
