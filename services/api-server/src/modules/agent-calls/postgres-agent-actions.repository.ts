import type { Pool, QueryResultRow } from "pg";
import type {
  AgentRunDto,
  AgentToolExecutionDto,
} from "@translation/contracts";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  domainCommand,
  recordDomainCommand,
  stableDomainId,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";
import {
  assertAgentRunFence,
  canTransitionAgentRun,
  readAgentRun,
  requireAgentHandoff,
  requireAgentRun,
  requireAgentStep,
  requireAgentTool,
  storeAgentRecord,
  type PostgresAgentHandoffRecord,
  type PostgresAgentStepRecord,
  type PostgresAgentToolRecord,
} from "./postgres-agent-uow.js";

export class PostgresAgentActionsRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async requestTool(input: {
    runId: string;
    stepId?: string;
    toolName: string;
    toolVersion: string;
    argumentsHash: string;
    riskLevel: "low" | "sensitive";
    approved: boolean;
    idempotencyKey: string;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "agent.tool.request",
      requestHash: input.requestHash,
    });
    const execute = () => this.primary.withAggregateTransaction(input.fence,
      async (transaction) => {
        const replay = await transaction.readCommandResult<unknown>(command);
        if (replay) return replay;
        const run = await readAgentRun(transaction, input.runId);
        if (!run) return recordDomainCommand(transaction, command, { status: "not_found" });
        assertAgentRunFence(input.fence, run.run);
        if (input.stepId) {
          const stepPrimary = await transaction.read<PostgresAgentStepRecord>(
            "agentSteps",
            input.stepId,
          );
          if (!stepPrimary) {
            return recordDomainCommand(transaction, command, { status: "step_not_found" });
          }
          const step = requireAgentStep(stepPrimary.payload, input.stepId);
          if (step.runId !== input.runId) throw new Error("Agent tool step run mismatch");
        }
        const same = await transaction.queryRead<IdRow>(`
          SELECT id FROM ai_phone.tool_executions
          WHERE run_id = $1 AND idempotency_key = $2
        `, [input.runId, input.idempotencyKey]);
        if (same[0]) {
          const existing = await transaction.read<PostgresAgentToolRecord>(
            "agentToolExecutions",
            same[0].id,
          );
          if (!existing) throw new Error("Agent tool primary record is missing");
          const execution = requireAgentTool(existing.payload, same[0].id);
          return recordDomainCommand(transaction, command, {
            status: execution.requestHash === input.requestHash
              ? "replayed" : "payload_conflict",
            execution,
          });
        }
        const execution: PostgresAgentToolRecord = {
          id: stableDomainId("agent_tool", `${input.runId}:${input.idempotencyKey}`),
          runId: input.runId,
          ...(input.stepId ? { stepId: input.stepId } : {}),
          toolName: input.toolName,
          toolVersion: input.toolVersion,
          argumentsHash: input.argumentsHash,
          riskLevel: input.riskLevel,
          approvalStatus: input.riskLevel === "low"
            ? "not_required"
            : input.approved ? "approved" : "pending",
          status: "requested",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          createdAt: (input.now ?? new Date()).toISOString(),
        };
        requireAgentTool(execution, execution.id);
        const stored = await storeAgentRecord(transaction, {
          namespace: "agentToolExecutions", recordKey: execution.id,
          record: execution, expectedRecordVersion: null,
          commandId: input.commandId, suffix: "agent:tool:request",
          eventType: "agent.tool.requested", aggregateVersion: 1,
          ...(run.run.sessionId ? { sessionId: run.run.sessionId } : {}),
        });
        return recordDomainCommand(transaction, command, {
          status: "created",
          execution: requireAgentTool(stored.payload, execution.id),
        });
      });
    try {
      return await execute();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return execute();
    }
  }

  async updateTool(input: {
    executionId: string;
    runId: string;
    status: "running" | "succeeded" | "failed" | "cancelled";
    providerOperationId?: string;
    resultSummary?: string;
    expectedRecordVersion?: number;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "agent.tool.update",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<unknown>(command);
      if (replay) return replay;
      const run = await readAgentRun(transaction, input.runId);
      if (!run) return recordDomainCommand(transaction, command, { status: "not_found" });
      assertAgentRunFence(input.fence, run.run);
      const primary = await transaction.read<PostgresAgentToolRecord>(
        "agentToolExecutions",
        input.executionId,
      );
      if (!primary) return recordDomainCommand(transaction, command, { status: "not_found" });
      const current = requireAgentTool(primary.payload, input.executionId);
      if (current.runId !== input.runId) throw new Error("Agent tool run mismatch");
      if (input.expectedRecordVersion !== undefined &&
        primary.recordVersion !== input.expectedRecordVersion) {
        return recordDomainCommand(transaction, command, {
          status: "version_conflict", execution: current,
        });
      }
      if (!canTransitionTool(current.status, input.status)) {
        return recordDomainCommand(transaction, command, {
          status: "invalid_transition", execution: current,
        });
      }
      const next: PostgresAgentToolRecord = {
        ...current, status: input.status,
        ...(input.providerOperationId ? { providerOperationId: input.providerOperationId } : {}),
        ...(input.resultSummary ? { resultSummary: input.resultSummary.slice(0, 800) } : {}),
      };
      if (["succeeded", "failed", "cancelled"].includes(input.status)) {
        next.endedAt ??= (input.now ?? new Date()).toISOString();
      }
      const stored = await storeAgentRecord(transaction, {
        namespace: "agentToolExecutions", recordKey: next.id, record: next,
        expectedRecordVersion: primary.recordVersion, commandId: input.commandId,
        suffix: "agent:tool:update", eventType: `agent.tool.${next.status}`,
        aggregateVersion: primary.recordVersion + 1,
        ...(run.run.sessionId ? { sessionId: run.run.sessionId } : {}),
      });
      return recordDomainCommand(transaction, command, {
        status: "updated", execution: requireAgentTool(stored.payload, next.id),
      });
    });
  }

  async createHandoff(input: {
    runId: string;
    reason: string;
    redactedSummary: string;
    target: "user" | "operator";
    idempotencyKey: string;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "agent.handoff.create",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<unknown>(command);
      if (replay) return replay;
      const run = await readAgentRun(transaction, input.runId);
      if (!run) return recordDomainCommand(transaction, command, { status: "not_found" });
      assertAgentRunFence(input.fence, run.run);
      const same = await transaction.queryRead<IdRow>(`
        SELECT id FROM ai_phone.handoff_records
        WHERE run_id = $1 AND idempotency_key = $2
      `, [input.runId, input.idempotencyKey]);
      if (same[0]) {
        const primary = await transaction.read<PostgresAgentHandoffRecord>(
          "agentHandoffs",
          same[0].id,
        );
        if (!primary) throw new Error("Agent handoff primary record is missing");
        const handoff = requireAgentHandoff(primary.payload, same[0].id);
        return recordDomainCommand(transaction, command, {
          status: handoff.requestHash === input.requestHash
            ? "replayed" : "payload_conflict",
          handoff,
        });
      }
      const rows = await transaction.queryRead<IdRow>(`
        SELECT id FROM ai_phone.handoff_records
        WHERE run_id = $1 AND target = $2 AND status = 'requested' LIMIT 1
      `, [input.runId, input.target]);
      if (rows[0]) {
        const primary = await transaction.read<PostgresAgentHandoffRecord>(
          "agentHandoffs",
          rows[0].id,
        );
        if (!primary) throw new Error("Agent handoff primary record is missing");
        return recordDomainCommand(transaction, command, {
          status: "existing", handoff: requireAgentHandoff(primary.payload, rows[0].id),
        });
      }
      const now = (input.now ?? new Date()).toISOString();
      const handoff: PostgresAgentHandoffRecord = {
        id: stableDomainId(
          "handoff",
          `${input.runId}:${input.target}:${input.idempotencyKey}`,
        ),
        runId: input.runId,
        reason: input.reason.slice(0, 120),
        redactedSummary: input.redactedSummary.slice(0, 800),
        target: input.target, status: "requested",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        requestedAt: now,
      };
      requireAgentHandoff(handoff, handoff.id);
      const stored = await storeAgentRecord(transaction, {
        namespace: "agentHandoffs", recordKey: handoff.id, record: handoff,
        expectedRecordVersion: null, commandId: input.commandId,
        suffix: "agent:handoff:create", eventType: "agent.handoff.requested",
        aggregateVersion: 1,
        ...(run.run.sessionId ? { sessionId: run.run.sessionId } : {}),
      });
      const updatedRun = await this.storeRunStatus(
        transaction, run, "takeover_requested", input.commandId,
      );
      return recordDomainCommand(transaction, command, {
        status: "created",
        handoff: requireAgentHandoff(stored.payload, handoff.id),
        run: updatedRun,
      });
    });
  }

  private async storeRunStatus(
    transaction: Parameters<typeof readAgentRun>[0],
    current: NonNullable<Awaited<ReturnType<typeof readAgentRun>>>,
    status: AgentRunDto["status"],
    commandId: string,
  ) {
    if (!canTransitionAgentRun(current.run.status, status)) {
      throw new Error("Agent run cannot enter handoff state");
    }
    const next = { ...current.run, status };
    const stored = await storeAgentRecord(transaction, {
      namespace: "agentRuns", recordKey: next.id, record: next,
      expectedRecordVersion: current.primary.recordVersion,
      commandId, suffix: "agent:run:handoff", eventType: `agent.run.${status}`,
      aggregateVersion: current.primary.recordVersion + 1,
      ...(next.sessionId ? { sessionId: next.sessionId } : {}),
    });
    return requireAgentRun(stored.payload, next.id);
  }
}

function canTransitionTool(
  current: AgentToolExecutionDto["status"],
  next: AgentToolExecutionDto["status"],
) {
  if (current === next) return true;
  if (current === "requested") return ["running", "cancelled", "failed"].includes(next);
  return current === "running" && ["succeeded", "failed", "cancelled"].includes(next);
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "23505");
}

interface IdRow extends QueryResultRow { id: string }
