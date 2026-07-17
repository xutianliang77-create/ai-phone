import type {
  AgentExecutionMode,
  AgentRunStatus,
  AgentStepDecisionType,
} from "@translation/contracts";
import { getStoreSnapshot } from
  "../../infrastructure/storage/json-store.js";

const activeRunStatuses = new Set<AgentRunStatus>([
  "ready",
  "running",
  "takeover_requested",
]);

export function isActiveAgentRunStatus(status: AgentRunStatus) {
  return activeRunStatuses.has(status);
}

export function findAgentRun(runId: string) {
  return getStoreSnapshot().agentRuns.find((run) => run.id === runId) ?? null;
}

export function findActiveAgentRun(taskId: string, mode: AgentExecutionMode) {
  return getStoreSnapshot().agentRuns.find((run) =>
    run.taskId === taskId && run.mode === mode &&
    isActiveAgentRunStatus(run.status)
  ) ?? null;
}

export function findAgentStepByIdempotency(
  runId: string,
  idempotencyKey: string,
) {
  return getStoreSnapshot().agentSteps.find((step) =>
    step.runId === runId && step.idempotencyKey === idempotencyKey
  ) ?? null;
}

export function hasAgentStepDecision(
  runId: string,
  decisionType: AgentStepDecisionType,
) {
  return getStoreSnapshot().agentSteps.some((step) =>
    step.runId === runId && step.decisionType === decisionType &&
    step.status === "executed"
  );
}

export function hasAgentRuntimeEvent(runId: string, event: string) {
  return hasAgentEvent(runId, (value) => value.event === event);
}

export function hasAgentAmdCategory(runId: string, categories: string[]) {
  return hasAgentEvent(runId, (value) =>
    value.event === "amd_classified" &&
    typeof value.amdCategory === "string" &&
    categories.includes(value.amdCategory)
  );
}

export function findAgentToolExecution(executionId: string) {
  return getStoreSnapshot().agentToolExecutions.find(
    (execution) => execution.id === executionId,
  ) ?? null;
}

function hasAgentEvent(
  runId: string,
  predicate: (value: Record<string, unknown>) => boolean,
) {
  return getStoreSnapshot().agentSteps.some((step) => {
    if (step.runId !== runId || step.status !== "executed" ||
      !step.outputSummary) return false;
    try {
      return predicate(JSON.parse(step.outputSummary) as Record<string, unknown>);
    } catch {
      return false;
    }
  });
}
