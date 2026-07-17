import { randomUUID } from "node:crypto";
import type {
  AgentExecutionMode,
  AgentRunStatus,
  AgentStepDecisionType,
} from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";

const activeRunStatuses = new Set<AgentRunStatus>([
  "ready",
  "running",
  "takeover_requested",
]);

export function beginAgentRun(input: {
  taskId: string;
  sessionId?: string;
  mode: AgentExecutionMode;
  policyVersion: string;
  modelProfileId?: string;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const store = getStoreSnapshot();
    const existing = store.agentRuns.find((run) =>
      run.taskId === input.taskId && run.mode === input.mode &&
      activeRunStatuses.has(run.status)
    );
    if (existing) return { status: "existing" as const, run: existing };
    const attempt = store.agentRuns
      .filter((run) => run.taskId === input.taskId && run.mode === input.mode)
      .reduce((value, run) => Math.max(value, run.attempt), 0) + 1;
    const now = (input.now ?? new Date()).toISOString();
    const run = {
      id: randomUUID(),
      taskId: input.taskId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      attempt,
      mode: input.mode,
      status: "ready" as const,
      policyVersion: input.policyVersion,
      ...(input.modelProfileId ? { modelProfileId: input.modelProfileId } : {}),
      createdAt: now,
    };
    store.agentRuns.push(run);
    persistStoreSnapshot();
    return { status: "created" as const, run };
  });
}

export function updateAgentRun(input: {
  runId: string;
  status: AgentRunStatus;
  failureCode?: string;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const run = findAgentRun(input.runId);
    if (!run) return null;
    if (!canTransition(run.status, input.status)) return run;
    const now = (input.now ?? new Date()).toISOString();
    run.status = input.status;
    if (input.status === "running") run.startedAt ??= now;
    if (["completed", "failed", "cancelled"].includes(input.status)) {
      run.endedAt ??= now;
    }
    if (input.failureCode) run.failureCode = input.failureCode.slice(0, 80);
    persistStoreSnapshot();
    return run;
  });
}

export function appendAgentStep(input: {
  runId: string;
  decisionType: AgentStepDecisionType;
  inputTurnId?: string;
  outputSummary?: string;
  latencyMs?: number;
  idempotencyKey: string;
  status?: "suggested" | "approved" | "rejected" | "executed" | "failed";
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const store = getStoreSnapshot();
    const existing = store.agentSteps.find((step) =>
      step.runId === input.runId && step.idempotencyKey === input.idempotencyKey
    );
    if (existing) return { status: "replayed" as const, step: existing };
    const sequence = store.agentSteps
      .filter((step) => step.runId === input.runId)
      .reduce((value, step) => Math.max(value, step.sequence), -1) + 1;
    const step = {
      id: randomUUID(),
      runId: input.runId,
      sequence,
      decisionType: input.decisionType,
      ...(input.inputTurnId ? { inputTurnId: input.inputTurnId } : {}),
      ...(input.outputSummary
        ? { outputSummary: input.outputSummary.slice(0, 800) }
        : {}),
      ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
      status: input.status ?? "suggested" as const,
      idempotencyKey: input.idempotencyKey,
      createdAt: (input.now ?? new Date()).toISOString(),
    };
    store.agentSteps.push(step);
    persistStoreSnapshot();
    return { status: "created" as const, step };
  });
}

export function requestAgentToolExecution(input: {
  runId: string;
  stepId?: string;
  toolName: string;
  toolVersion: string;
  argumentsHash: string;
  riskLevel: "low" | "sensitive";
  approved: boolean;
  idempotencyKey: string;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const store = getStoreSnapshot();
    const existing = store.agentToolExecutions.find((tool) =>
      tool.runId === input.runId && tool.idempotencyKey === input.idempotencyKey
    );
    if (existing) return { status: "replayed" as const, execution: existing };
    const approvalStatus = input.riskLevel === "low"
      ? "not_required" as const
      : input.approved ? "approved" as const : "pending" as const;
    const execution = {
      id: randomUUID(),
      runId: input.runId,
      ...(input.stepId ? { stepId: input.stepId } : {}),
      toolName: input.toolName,
      toolVersion: input.toolVersion,
      argumentsHash: input.argumentsHash,
      riskLevel: input.riskLevel,
      approvalStatus,
      status: "requested" as const,
      idempotencyKey: input.idempotencyKey,
      createdAt: (input.now ?? new Date()).toISOString(),
    };
    store.agentToolExecutions.push(execution);
    persistStoreSnapshot();
    return { status: "created" as const, execution };
  });
}

export function updateAgentToolExecution(input: {
  executionId: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  providerOperationId?: string;
  resultSummary?: string;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const execution = getStoreSnapshot().agentToolExecutions.find(
      (item) => item.id === input.executionId,
    );
    if (!execution) return null;
    const terminal = ["succeeded", "failed", "cancelled"];
    if (terminal.includes(execution.status)) return execution;
    if (execution.status === "requested" && input.status !== "running" &&
      !terminal.includes(input.status)) return execution;
    execution.status = input.status;
    if (input.providerOperationId) {
      execution.providerOperationId = input.providerOperationId;
    }
    if (input.resultSummary) {
      execution.resultSummary = input.resultSummary.slice(0, 800);
    }
    if (terminal.includes(input.status)) {
      execution.endedAt ??= (input.now ?? new Date()).toISOString();
    }
    persistStoreSnapshot();
    return execution;
  });
}

export function findAgentToolExecutionForTask(
  taskId: string,
  idempotencyKey: string,
) {
  const runIds = new Set(getStoreSnapshot().agentRuns
    .filter((run) => run.taskId === taskId)
    .map((run) => run.id));
  return getStoreSnapshot().agentToolExecutions.find((execution) =>
    runIds.has(execution.runId) && execution.idempotencyKey === idempotencyKey
  ) ?? null;
}

export function findAgentToolExecutionByProviderOperation(operationId: string) {
  return getStoreSnapshot().agentToolExecutions.find(
    (execution) => execution.providerOperationId === operationId,
  ) ?? null;
}

export function createAgentHandoff(input: {
  runId: string;
  reason: string;
  redactedSummary: string;
  target: "user" | "operator";
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const existing = getStoreSnapshot().agentHandoffs.find((handoff) =>
      handoff.runId === input.runId && handoff.target === input.target &&
      handoff.status === "requested"
    );
    if (existing) return existing;
    const handoff = {
      id: randomUUID(),
      runId: input.runId,
      reason: input.reason.slice(0, 120),
      redactedSummary: input.redactedSummary.slice(0, 800),
      target: input.target,
      status: "requested" as const,
      requestedAt: (input.now ?? new Date()).toISOString(),
    };
    getStoreSnapshot().agentHandoffs.push(handoff);
    updateAgentRun({ runId: input.runId, status: "takeover_requested" });
    persistStoreSnapshot();
    return handoff;
  });
}

export function acceptAgentHandoff(
  runId: string,
  target: "user" | "operator" = "user",
  now = new Date(),
) {
  return runStoreTransaction(() => {
    const handoffs = getStoreSnapshot().agentHandoffs.filter((item) =>
      item.runId === runId && item.target === target
    );
    const handoff = handoffs.find((item) => item.status === "requested") ??
      [...handoffs].reverse().find((item) => item.status === "accepted");
    if (!handoff || handoff.status === "failed") return null;
    if (handoff.status === "accepted") return handoff;
    handoff.status = "accepted";
    handoff.acceptedAt = now.toISOString();
    persistStoreSnapshot();
    return handoff;
  });
}

export function rejectAgentHandoff(
  runId: string,
  target: "user" | "operator" = "user",
  now = new Date(),
) {
  return runStoreTransaction(() => {
    const handoffs = getStoreSnapshot().agentHandoffs.filter((item) =>
      item.runId === runId && item.target === target
    );
    const handoff = handoffs.find((item) =>
      item.runId === runId && item.target === target && item.status === "requested"
    ) ?? [...handoffs].reverse().find((item) => item.status === "failed");
    if (!handoff || handoff.status === "accepted") return null;
    if (handoff.status === "failed") return handoff;
    handoff.status = "failed";
    handoff.failedAt = now.toISOString();
    updateAgentRun({ runId, status: "running", now });
    persistStoreSnapshot();
    return handoff;
  });
}

export function findRequestedAgentHandoff(
  runId: string,
  target?: "user" | "operator",
) {
  return getStoreSnapshot().agentHandoffs.find(
    (handoff) => handoff.runId === runId && handoff.status === "requested" &&
      (!target || handoff.target === target),
  ) ?? null;
}

export function expireAgentHandoff(
  runId: string,
  target: "user" | "operator" = "user",
  now = new Date(),
) {
  return runStoreTransaction(() => {
    const handoff = findRequestedAgentHandoff(runId, target);
    if (!handoff) return null;
    handoff.status = "failed";
    handoff.failedAt = now.toISOString();
    persistStoreSnapshot();
    return handoff;
  });
}

export function acceptAgentHandoffById(handoffId: string, now = new Date()) {
  return updateAgentHandoffById(handoffId, "accepted", now);
}

export function rejectAgentHandoffById(handoffId: string, now = new Date()) {
  return updateAgentHandoffById(handoffId, "failed", now);
}

function updateAgentHandoffById(
  handoffId: string,
  status: "accepted" | "failed",
  now: Date,
) {
  return runStoreTransaction(() => {
    const handoff = getStoreSnapshot().agentHandoffs.find((item) =>
      item.id === handoffId
    );
    if (!handoff || (handoff.status !== "requested" && handoff.status !== status)) {
      return null;
    }
    handoff.status = status;
    if (status === "accepted") handoff.acceptedAt ??= now.toISOString();
    else handoff.failedAt ??= now.toISOString();
    persistStoreSnapshot();
    return handoff;
  });
}

export function findAgentRun(runId: string) {
  return getStoreSnapshot().agentRuns.find((run) => run.id === runId) ?? null;
}

export function findActiveAgentRun(taskId: string, mode: AgentExecutionMode) {
  return getStoreSnapshot().agentRuns.find((run) =>
    run.taskId === taskId && run.mode === mode && activeRunStatuses.has(run.status)
  ) ?? null;
}

export function findAgentStepByIdempotency(runId: string, idempotencyKey: string) {
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
  return getStoreSnapshot().agentSteps.some((step) => {
    if (step.runId !== runId || step.status !== "executed" ||
      !step.outputSummary) return false;
    try {
      const value = JSON.parse(step.outputSummary) as Record<string, unknown>;
      return value.event === event;
    } catch {
      return false;
    }
  });
}

export function hasAgentAmdCategory(runId: string, categories: string[]) {
  return getStoreSnapshot().agentSteps.some((step) => {
    if (step.runId !== runId || step.status !== "executed" ||
      !step.outputSummary) return false;
    try {
      const value = JSON.parse(step.outputSummary) as Record<string, unknown>;
      return value.event === "amd_classified" &&
        typeof value.amdCategory === "string" &&
        categories.includes(value.amdCategory);
    } catch {
      return false;
    }
  });
}

export function findAgentToolExecution(executionId: string) {
  return getStoreSnapshot().agentToolExecutions.find(
    (execution) => execution.id === executionId,
  ) ?? null;
}

function canTransition(current: AgentRunStatus, next: AgentRunStatus) {
  if (current === next) return true;
  const allowed: Record<AgentRunStatus, AgentRunStatus[]> = {
    ready: ["running", "takeover_requested", "cancelled", "failed"],
    running: ["takeover_requested", "completed", "failed", "cancelled"],
    takeover_requested: ["running", "completed", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: [],
  };
  return allowed[current].includes(next);
}
