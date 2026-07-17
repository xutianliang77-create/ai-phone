import type {
  AgentConsultDto,
  AgentRunStatus,
} from "@translation/contracts";
import type {
  PostgresPrimaryRecord,
  PostgresPrimaryTransaction,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  canTransitionAgentRun,
  requireAgentConsult,
  requireAgentHandoff,
  requireAgentRun,
  storeAgentRecord,
  type PostgresAgentHandoffRecord,
  type PostgresAgentRunRecord,
} from "./postgres-agent-uow.js";

export async function storeAgentConsult(
  transaction: PostgresPrimaryTransaction,
  input: {
    consult: AgentConsultDto;
    expectedRecordVersion: number | null;
    commandId: string;
    suffix: string;
    eventType: string;
  },
) {
  const stored = await storeAgentRecord(transaction, {
    namespace: "agentConsults",
    recordKey: input.consult.id,
    record: input.consult,
    expectedRecordVersion: input.expectedRecordVersion,
    commandId: input.commandId,
    suffix: input.suffix,
    eventType: input.eventType,
    aggregateVersion: input.consult.version,
    sessionId: input.consult.sessionId,
  });
  return requireAgentConsult(stored.payload, input.consult.id);
}

export async function storeAgentConsultRunStatus(
  transaction: PostgresPrimaryTransaction,
  current: {
    run: PostgresAgentRunRecord;
    primary: PostgresPrimaryRecord<PostgresAgentRunRecord>;
  },
  status: AgentRunStatus,
  input: { commandId: string; suffix: string; now: string },
) {
  if (current.run.status === status) return current.run;
  if (!canTransitionAgentRun(current.run.status, status)) {
    throw new Error(`Agent run cannot transition to ${status}`);
  }
  const next: PostgresAgentRunRecord = { ...current.run, status };
  if (status === "running") next.startedAt ??= input.now;
  if (["completed", "failed", "cancelled"].includes(status)) next.endedAt ??= input.now;
  const stored = await storeAgentRecord(transaction, {
    namespace: "agentRuns", recordKey: next.id, record: next,
    expectedRecordVersion: current.primary.recordVersion,
    commandId: input.commandId, suffix: input.suffix,
    eventType: `agent.run.${status}`,
    aggregateVersion: current.primary.recordVersion + 1,
    ...(next.sessionId ? { sessionId: next.sessionId } : {}),
  });
  return requireAgentRun(stored.payload, next.id);
}

export async function storeAgentConsultHandoffStatus(
  transaction: PostgresPrimaryTransaction,
  current: {
    handoff: PostgresAgentHandoffRecord;
    primary: PostgresPrimaryRecord<PostgresAgentHandoffRecord>;
  },
  status: "accepted" | "failed",
  input: { commandId: string; suffix: string; now: string; sessionId: string },
) {
  if (current.handoff.status === status) return current.handoff;
  if (current.handoff.status !== "requested") {
    throw new Error(`Agent handoff cannot transition to ${status}`);
  }
  const next: PostgresAgentHandoffRecord = {
    ...current.handoff,
    status,
    ...(status === "accepted" ? { acceptedAt: input.now } : { failedAt: input.now }),
  };
  const stored = await storeAgentRecord(transaction, {
    namespace: "agentHandoffs", recordKey: next.id, record: next,
    expectedRecordVersion: current.primary.recordVersion,
    commandId: input.commandId, suffix: input.suffix,
    eventType: `agent.handoff.${status}`,
    aggregateVersion: current.primary.recordVersion + 1,
    sessionId: input.sessionId,
  });
  return requireAgentHandoff(stored.payload, next.id);
}
