import type { QueryResultRow } from "pg";
import type {
  AgentRunDto,
  AgentToolExecutionDto,
} from "@translation/contracts";
import type { PostgresPrimaryTransaction } from
  "../../infrastructure/storage/postgres-primary-store.js";
import {
  canTransitionAgentRun,
  type readAgentRun,
  requireAgentRun,
  storeAgentRecord,
} from "./postgres-agent-uow.js";

export interface IdRow extends QueryResultRow { id: string }

export function canTransitionTool(
  current: AgentToolExecutionDto["status"],
  next: AgentToolExecutionDto["status"],
) {
  if (current === next) return true;
  if (current === "requested") {
    return ["running", "cancelled", "failed"].includes(next);
  }
  return current === "running" &&
    ["succeeded", "failed", "cancelled"].includes(next);
}

export function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "23505");
}

export async function storeHandoffRunStatus(
  transaction: PostgresPrimaryTransaction,
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
