import type { Pool, QueryResultRow } from "pg";
import type {
  AgentExecutionMode,
  AgentRunDto,
  AgentRunStatus,
  AgentStepDecisionType,
  AgentStepDto,
} from "@translation/contracts";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  assertDomainFence,
  domainCommand,
  recordDomainCommand,
  stableDomainId,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";
import {
  activeAgentRunStatuses,
  assertAgentRunFence,
  canTransitionAgentRun,
  readAgentRun,
  requireAgentRun,
  requireAgentStep,
  storeAgentRecord,
  type PostgresAgentRunRecord,
  type PostgresAgentStepRecord,
} from "./postgres-agent-uow.js";

export class PostgresAgentRunsRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async begin(input: {
    taskId: string;
    sessionId?: string;
    mode: AgentExecutionMode;
    policyVersion: string;
    modelProfileId?: string;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    assertDomainFence(
      input.fence,
      input.sessionId ? "communication_session" : "agent_task",
      input.sessionId ?? input.taskId,
    );
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "agent.run.begin",
      requestHash: input.requestHash,
    });
    const execute = () => this.primary.withAggregateTransaction(input.fence,
      async (transaction) => {
        const replay = await transaction.readCommandResult<{
          status: string; run: AgentRunDto;
        }>(command);
        if (replay) return replay;
        const task = await transaction.queryRead<IdRow>(`
          SELECT id FROM ai_phone.agent_tasks WHERE id = $1 FOR UPDATE
        `, [input.taskId]);
        if (!task[0]) throw new Error("Agent task is unavailable");
        const active = await transaction.queryRead<IdRow>(`
          SELECT id FROM ai_phone.agent_runs
          WHERE task_id = $1 AND mode = $2 AND status = ANY($3::text[])
          ORDER BY attempt DESC LIMIT 1
        `, [input.taskId, input.mode, [...activeAgentRunStatuses]]);
        if (active[0]) {
          const existing = await readAgentRun(transaction, active[0].id);
          if (!existing) throw new Error("Agent run primary record is missing");
          assertAgentRunFence(input.fence, existing.run);
          return recordDomainCommand(transaction, command, {
            status: existing.run.requestHash === input.requestHash
              ? "existing" : "active_conflict",
            run: existing.run,
          });
        }
        const attempts = await transaction.queryRead<AttemptRow>(`
          SELECT COALESCE(max(attempt), 0)::text AS attempt
          FROM ai_phone.agent_runs WHERE task_id = $1 AND mode = $2
        `, [input.taskId, input.mode]);
        const attempt = Number(attempts[0]?.attempt ?? 0) + 1;
        if (!Number.isSafeInteger(attempt) || attempt < 1) {
          throw new Error("Invalid Agent run attempt");
        }
        const now = (input.now ?? new Date()).toISOString();
        const run: PostgresAgentRunRecord = {
          id: stableDomainId("agent_run", `${input.taskId}:${input.mode}:${attempt}`),
          taskId: input.taskId,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          attempt,
          mode: input.mode,
          status: "ready",
          policyVersion: input.policyVersion,
          requestHash: input.requestHash,
          ...(input.modelProfileId ? { modelProfileId: input.modelProfileId } : {}),
          createdAt: now,
        };
        requireAgentRun(run, run.id);
        const stored = await storeAgentRecord(transaction, {
          namespace: "agentRuns", recordKey: run.id, record: run,
          expectedRecordVersion: null, commandId: input.commandId,
          suffix: "agent:run:begin", eventType: "agent.run.ready",
          aggregateVersion: 1, ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        });
        return recordDomainCommand(transaction, command, {
          status: "created", run: requireAgentRun(stored.payload, run.id),
        });
      });
    try {
      return await execute();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return execute();
    }
  }

  async update(input: {
    runId: string;
    status: AgentRunStatus;
    failureCode?: string;
    expectedRecordVersion?: number;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "agent.run.update",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<unknown>(command);
      if (replay) return replay;
      const current = await readAgentRun(transaction, input.runId);
      if (!current) return recordDomainCommand(transaction, command, { status: "not_found" });
      assertAgentRunFence(input.fence, current.run);
      if (input.expectedRecordVersion !== undefined &&
        current.primary.recordVersion !== input.expectedRecordVersion) {
        return recordDomainCommand(transaction, command, {
          status: "version_conflict", run: current.run,
        });
      }
      if (!canTransitionAgentRun(current.run.status, input.status)) {
        return recordDomainCommand(transaction, command, {
          status: "invalid_transition", run: current.run,
        });
      }
      const now = (input.now ?? new Date()).toISOString();
      const next: PostgresAgentRunRecord = {
        ...current.run, status: input.status,
        ...(input.failureCode ? { failureCode: input.failureCode.slice(0, 80) } : {}),
      };
      if (input.status === "running") next.startedAt ??= now;
      if (["completed", "failed", "cancelled"].includes(input.status)) {
        next.endedAt ??= now;
      }
      const stored = await storeAgentRecord(transaction, {
        namespace: "agentRuns", recordKey: next.id, record: next,
        expectedRecordVersion: current.primary.recordVersion,
        commandId: input.commandId, suffix: "agent:run:update",
        eventType: `agent.run.${next.status}`,
        aggregateVersion: current.primary.recordVersion + 1,
        ...(next.sessionId ? { sessionId: next.sessionId } : {}),
      });
      return recordDomainCommand(transaction, command, {
        status: "updated", run: requireAgentRun(stored.payload, next.id),
      });
    });
  }

  async appendStep(input: {
    runId: string;
    decisionType: AgentStepDecisionType;
    inputTurnId?: string;
    outputSummary?: string;
    latencyMs?: number;
    status?: AgentStepDto["status"];
    idempotencyKey: string;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "agent.step.append",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<unknown>(command);
      if (replay) return replay;
      const run = await readAgentRun(transaction, input.runId);
      if (!run) return recordDomainCommand(transaction, command, { status: "not_found" });
      assertAgentRunFence(input.fence, run.run);
      const same = await transaction.queryRead<IdRow>(`
        SELECT id FROM ai_phone.agent_steps
        WHERE run_id = $1 AND idempotency_key = $2
      `, [input.runId, input.idempotencyKey]);
      if (same[0]) {
        const primary = await transaction.read<PostgresAgentStepRecord>(
          "agentSteps",
          same[0].id,
        );
        if (!primary) throw new Error("Agent step primary record is missing");
        const step = requireAgentStep(primary.payload, same[0].id);
        return recordDomainCommand(transaction, command, {
          status: step.requestHash === input.requestHash
            ? "replayed" : "payload_conflict",
          step,
        });
      }
      const sequences = await transaction.queryRead<SequenceRow>(`
        SELECT COALESCE(max(sequence), -1)::text AS sequence
        FROM ai_phone.agent_steps WHERE run_id = $1
      `, [input.runId]);
      const sequence = Number(sequences[0]?.sequence ?? -1) + 1;
      const step: PostgresAgentStepRecord = {
        id: stableDomainId("agent_step", `${input.runId}:${input.idempotencyKey}`),
        runId: input.runId, sequence, decisionType: input.decisionType,
        ...(input.inputTurnId ? { inputTurnId: input.inputTurnId } : {}),
        ...(input.outputSummary ? { outputSummary: input.outputSummary.slice(0, 800) } : {}),
        ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
        status: input.status ?? "suggested", idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        createdAt: (input.now ?? new Date()).toISOString(),
      };
      requireAgentStep(step, step.id);
      const stored = await storeAgentRecord(transaction, {
        namespace: "agentSteps", recordKey: step.id, record: step,
        expectedRecordVersion: null, commandId: input.commandId,
        suffix: "agent:step:append", eventType: "agent.step.appended",
        aggregateVersion: sequence + 1,
        ...(run.run.sessionId ? { sessionId: run.run.sessionId } : {}),
      });
      return recordDomainCommand(transaction, command, {
        status: "created", step: requireAgentStep(stored.payload, step.id),
      });
    });
  }

  async find(runId: string) {
    const primary = await this.primary.read<PostgresAgentRunRecord>("agentRuns", runId);
    return primary ? requireAgentRun(primary.payload, runId) : null;
  }

  async findActive(taskId: string, mode: AgentExecutionMode) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<IdRow>(`
        SELECT run.id FROM ai_phone.agent_runs AS run
        WHERE run.task_id = $1 AND run.mode = $2
          AND run.status = ANY($3::text[])
        ORDER BY run.attempt DESC LIMIT 1
      `, [taskId, mode, [...activeAgentRunStatuses]]);
      return result.rows[0] ? this.find(result.rows[0].id) : null;
    } finally {
      client.release();
    }
  }

  async findStepByIdempotency(runId: string, idempotencyKey: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<IdRow>(`
        SELECT id FROM ai_phone.agent_steps
        WHERE run_id = $1 AND idempotency_key = $2 LIMIT 1
      `, [runId, idempotencyKey]);
      const id = result.rows[0]?.id;
      if (!id) return null;
      const primary = await this.primary.read<PostgresAgentStepRecord>("agentSteps", id);
      return primary ? requireAgentStep(primary.payload, id) : null;
    } finally {
      client.release();
    }
  }

  async listExecutedSteps(runId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<IdRow>(`
        SELECT id FROM ai_phone.agent_steps
        WHERE run_id = $1 AND status = 'executed' ORDER BY sequence ASC
      `, [runId]);
      const steps = await Promise.all(result.rows.map(async ({ id }) => {
        const primary = await this.primary.read<PostgresAgentStepRecord>("agentSteps", id);
        return primary ? requireAgentStep(primary.payload, id) : null;
      }));
      return steps.filter((step): step is PostgresAgentStepRecord => Boolean(step));
    } finally {
      client.release();
    }
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "23505");
}

interface IdRow extends QueryResultRow { id: string }
interface AttemptRow extends QueryResultRow { attempt: string }
interface SequenceRow extends QueryResultRow { sequence: string }
