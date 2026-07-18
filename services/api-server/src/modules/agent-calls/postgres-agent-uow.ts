import type {
  AgentConsultDto,
  AgentHandoffDto,
  AgentRunDto,
  AgentRunStatus,
  AgentStepDto,
  AgentToolExecutionDto,
} from "@translation/contracts";
import type {
  PostgresAggregateFence,
  PostgresPrimaryTransaction,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  assertDomainFence,
  bounded,
  domainEventId,
  enqueueDomainEvent,
  validTimestamp,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";

export const activeAgentRunStatuses = new Set<AgentRunStatus>([
  "ready",
  "running",
  "takeover_requested",
]);

export type PostgresAgentRunRecord = AgentRunDto & { requestHash: string };
export type PostgresAgentStepRecord = AgentStepDto & { requestHash: string };
export type PostgresAgentToolRecord = AgentToolExecutionDto & { requestHash: string };
export type PostgresAgentHandoffRecord = AgentHandoffDto & {
  idempotencyKey: string;
  requestHash: string;
};

export function requireAgentRun(value: unknown, runId: string) {
  const run = value as Partial<PostgresAgentRunRecord> | null;
  if (!run || run.id !== runId || !bounded(run.taskId ?? "", 200) ||
    !positive(run.attempt) || !["assist", "autonomous"].includes(run.mode ?? "") ||
    !runStatus(run.status) || !bounded(run.policyVersion ?? "", 120) ||
    !requestHash(run.requestHash) || !validTimestamp(run.createdAt)) {
    throw new Error("Invalid PostgreSQL Agent run");
  }
  return run as PostgresAgentRunRecord;
}

export function requireAgentStep(value: unknown, stepId: string) {
  const step = value as Partial<PostgresAgentStepRecord> | null;
  if (!step || step.id !== stepId || !bounded(step.runId ?? "", 200) ||
    !nonnegative(step.sequence) || !bounded(step.decisionType ?? "", 80) ||
    !bounded(step.idempotencyKey ?? "", 200) || !requestHash(step.requestHash) ||
    !validTimestamp(step.createdAt)) {
    throw new Error("Invalid PostgreSQL Agent step");
  }
  return step as PostgresAgentStepRecord;
}

export function requireAgentTool(value: unknown, executionId: string) {
  const tool = value as Partial<PostgresAgentToolRecord> | null;
  if (!tool || tool.id !== executionId || !bounded(tool.runId ?? "", 200) ||
    !bounded(tool.toolName ?? "", 120) || !bounded(tool.toolVersion ?? "", 80) ||
    !bounded(tool.argumentsHash ?? "", 128) ||
    !bounded(tool.idempotencyKey ?? "", 200) || !requestHash(tool.requestHash) ||
    !validTimestamp(tool.createdAt)) {
    throw new Error("Invalid PostgreSQL Agent tool execution");
  }
  return tool as PostgresAgentToolRecord;
}

export function requireAgentHandoff(value: unknown, handoffId: string) {
  const handoff = value as Partial<PostgresAgentHandoffRecord> | null;
  if (!handoff || handoff.id !== handoffId || !bounded(handoff.runId ?? "", 200) ||
    !bounded(handoff.reason ?? "", 120) ||
    !bounded(handoff.redactedSummary ?? "", 800) ||
    !bounded(handoff.idempotencyKey ?? "", 200) ||
    !requestHash(handoff.requestHash) ||
    !["user", "operator"].includes(handoff.target ?? "") ||
    !["requested", "accepted", "failed"].includes(handoff.status ?? "") ||
    !validTimestamp(handoff.requestedAt)) {
    throw new Error("Invalid PostgreSQL Agent handoff");
  }
  return handoff as PostgresAgentHandoffRecord;
}

export function requireAgentConsult(value: unknown, consultId: string) {
  const consult = value as Partial<AgentConsultDto> | null;
  if (!consult || consult.id !== consultId || !bounded(consult.runId ?? "", 200) ||
    !bounded(consult.handoffId ?? "", 200) ||
    !bounded(consult.sessionId ?? "", 160) || !positive(consult.version) ||
    !bounded(consult.mainRoomName ?? "", 200) ||
    !bounded(consult.consultRoomName ?? "", 200) ||
    !bounded(consult.operatorPhoneHash ?? "", 128) ||
    !bounded(consult.operatorParticipantIdentity ?? "", 240) ||
    !["requested", "dialing", "connected", "merging", "merged", "rejected",
      "no_answer", "failed", "completed"].includes(consult.status ?? "") ||
    !bounded(consult.idempotencyKey ?? "", 200) ||
    !bounded(consult.requestHash ?? "", 128) ||
    (consult.requestHash?.length ?? 0) < 16 || !validTimestamp(consult.requestedAt) ||
    !validTimestamp(consult.expiresAt) || !validTimestamp(consult.updatedAt) ||
    Date.parse(consult.expiresAt ?? "") <= Date.parse(consult.requestedAt ?? "") ||
    (consult.billableSeconds !== undefined && !nonnegative(consult.billableSeconds))) {
    throw new Error("Invalid PostgreSQL Agent consult");
  }
  return consult as AgentConsultDto;
}

export function assertAgentRunFence(
  fence: PostgresAggregateFence,
  run: AgentRunDto,
) {
  assertDomainFence(
    fence,
    run.sessionId ? "communication_session" : "agent_task",
    run.sessionId ?? run.taskId,
  );
}

export async function storeAgentRecord<T>(
  transaction: PostgresPrimaryTransaction,
  input: {
    namespace: string;
    recordKey: string;
    record: T;
    expectedRecordVersion: number | null;
    commandId: string;
    suffix: string;
    eventType: string;
    aggregateVersion: number;
    sessionId?: string;
  },
) {
  const eventId = domainEventId(input.commandId, input.suffix);
  const stored = await transaction.mutate<T>({
    eventId,
    namespace: input.namespace,
    recordKey: input.recordKey,
    operation: "upsert",
    payload: input.record,
    expectedRecordVersion: input.expectedRecordVersion,
  });
  if (!stored) throw new Error("PostgreSQL Agent record was not stored");
  await enqueueDomainEvent(transaction, {
    eventId,
    eventType: input.eventType,
    aggregateVersion: input.aggregateVersion,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    payload: { record: stored.payload },
  });
  return stored;
}

export async function readAgentRun(
  transaction: PostgresPrimaryTransaction,
  runId: string,
) {
  const primary = await transaction.read<PostgresAgentRunRecord>("agentRuns", runId);
  return primary ? { run: requireAgentRun(primary.payload, runId), primary } : null;
}

export function canTransitionAgentRun(current: AgentRunStatus, next: AgentRunStatus) {
  if (current === next) return true;
  const allowed: Record<AgentRunStatus, AgentRunStatus[]> = {
    ready: ["running", "takeover_requested", "cancelled", "failed"],
    running: ["takeover_requested", "completed", "failed", "cancelled"],
    takeover_requested: ["running", "completed", "failed", "cancelled"],
    completed: [], failed: [], cancelled: [],
  };
  return allowed[current].includes(next);
}

function runStatus(value: unknown): value is AgentRunStatus {
  return typeof value === "string" && [
    ...activeAgentRunStatuses, "completed", "failed", "cancelled",
  ].includes(value as AgentRunStatus);
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function requestHash(value: unknown) {
  return typeof value === "string" && bounded(value, 128) && value.length >= 16;
}
