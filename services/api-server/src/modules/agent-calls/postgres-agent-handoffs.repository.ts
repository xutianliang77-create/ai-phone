import type { Pool } from "pg";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  domainCommand,
  recordDomainCommand,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";
import {
  assertAgentRunFence,
  canTransitionAgentRun,
  readAgentRun,
  requireAgentHandoff,
  requireAgentRun,
  storeAgentRecord,
  type PostgresAgentHandoffRecord,
} from "./postgres-agent-uow.js";

export class PostgresAgentHandoffsRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async transition(input: {
    handoffId: string;
    runId: string;
    status: "accepted" | "failed";
    expectedRecordVersion?: number;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "agent.handoff.transition",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<unknown>(command);
      if (replay) return replay;
      const run = await readAgentRun(transaction, input.runId);
      if (!run) return recordDomainCommand(transaction, command, { status: "not_found" });
      assertAgentRunFence(input.fence, run.run);
      const primary = await transaction.read<PostgresAgentHandoffRecord>(
        "agentHandoffs",
        input.handoffId,
      );
      if (!primary) return recordDomainCommand(transaction, command, { status: "not_found" });
      const current = requireAgentHandoff(primary.payload, input.handoffId);
      if (current.runId !== input.runId) throw new Error("Agent handoff run mismatch");
      if (input.expectedRecordVersion !== undefined &&
        primary.recordVersion !== input.expectedRecordVersion) {
        return recordDomainCommand(transaction, command, {
          status: "version_conflict", handoff: current,
        });
      }
      if (current.status === input.status) {
        return recordDomainCommand(transaction, command, {
          status: "replayed", handoff: current, run: run.run,
        });
      }
      if (current.status !== "requested") {
        return recordDomainCommand(transaction, command, {
          status: "invalid_transition", handoff: current,
        });
      }
      const now = (input.now ?? new Date()).toISOString();
      const next: PostgresAgentHandoffRecord = {
        ...current,
        status: input.status,
        ...(input.status === "accepted" ? { acceptedAt: now } : { failedAt: now }),
      };
      const stored = await storeAgentRecord(transaction, {
        namespace: "agentHandoffs", recordKey: next.id, record: next,
        expectedRecordVersion: primary.recordVersion, commandId: input.commandId,
        suffix: "agent:handoff:transition", eventType: `agent.handoff.${next.status}`,
        aggregateVersion: primary.recordVersion + 1,
        ...(run.run.sessionId ? { sessionId: run.run.sessionId } : {}),
      });
      const updatedRun = input.status === "failed" &&
        run.run.status === "takeover_requested"
        ? await storeRunStatus(transaction, run, input.commandId)
        : run.run;
      return recordDomainCommand(transaction, command, {
        status: "updated",
        handoff: requireAgentHandoff(stored.payload, next.id),
        run: updatedRun,
      });
    });
  }
}

async function storeRunStatus(
  transaction: Parameters<typeof readAgentRun>[0],
  current: NonNullable<Awaited<ReturnType<typeof readAgentRun>>>,
  commandId: string,
) {
  if (!canTransitionAgentRun(current.run.status, "running")) {
    throw new Error("Agent run cannot resume after failed handoff");
  }
  const next = { ...current.run, status: "running" as const };
  const stored = await storeAgentRecord(transaction, {
    namespace: "agentRuns", recordKey: next.id, record: next,
    expectedRecordVersion: current.primary.recordVersion,
    commandId, suffix: "agent:run:handoff-failed", eventType: "agent.run.running",
    aggregateVersion: current.primary.recordVersion + 1,
    ...(next.sessionId ? { sessionId: next.sessionId } : {}),
  });
  return requireAgentRun(stored.payload, next.id);
}
