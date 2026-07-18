import type {
  AgentExecutionMode,
  AgentHandoffDto,
  AgentRunDto,
  AgentRunStatus,
  AgentStepDecisionType,
  AgentStepDto,
  AgentToolExecutionDto,
} from "@translation/contracts";
import { withPostgresRepositoryFence } from "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from "../../infrastructure/storage/repository-runtime.js";
import * as legacy from "./agent-orchestration.repository.js";

export async function beginAgentRun(input: {
  taskId: string;
  sessionId?: string;
  mode: AgentExecutionMode;
  policyVersion: string;
  modelProfileId?: string;
  now?: Date;
}): Promise<{ status: string; run: AgentRunDto }> {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.beginAgentRun(input);
  const aggregateType = input.sessionId ? "communication_session" : "agent_task";
  const aggregateId = input.sessionId ?? input.taskId;
  return withPostgresRepositoryFence({ aggregateType, aggregateId }, async (fence) => {
    const requestHash = repositoryRequestHash(input);
    return runtime.postgres.agentRuns.begin({
      ...input,
      commandId: commandId(aggregateId, "run-begin", 1, requestHash),
      requestHash,
      fence,
    });
  }) as Promise<{ status: string; run: AgentRunDto }>;
}

export async function updateAgentRun(input: {
  runId: string;
  status: AgentRunStatus;
  failureCode?: string;
  now?: Date;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.updateAgentRun(input);
  const run = await runtime.postgres.agentRuns.find(input.runId);
  if (!run) return null;
  const aggregateType = run.sessionId ? "communication_session" : "agent_task";
  const aggregateId = run.sessionId ?? run.taskId;
  return withPostgresRepositoryFence({ aggregateType, aggregateId }, async (fence) => {
    const requestHash = repositoryRequestHash(input);
    const result = await runtime.postgres.agentRuns.update({
      ...input,
      commandId: commandId(aggregateId, `run-${input.status}`, 1, requestHash),
      requestHash,
      fence,
    });
    return hasRun(result) ? result.run : null;
  });
}

export async function appendAgentStep(input: {
  runId: string;
  decisionType: AgentStepDecisionType;
  inputTurnId?: string;
  outputSummary?: string;
  latencyMs?: number;
  idempotencyKey: string;
  status?: "suggested" | "approved" | "rejected" | "executed" | "failed";
  now?: Date;
}): Promise<{ status: string; step: AgentStepDto } | { status: "not_found" }> {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.appendAgentStep(input);
  const run = await runtime.postgres.agentRuns.find(input.runId);
  if (!run) return { status: "not_found" as const };
  const aggregateId = run.sessionId ?? run.taskId;
  const aggregateType = run.sessionId ? "communication_session" : "agent_task";
  return withPostgresRepositoryFence({ aggregateType, aggregateId }, (fence) => {
    const requestHash = repositoryRequestHash(input);
    return runtime.postgres.agentRuns.appendStep({
      ...input,
      commandId: commandId(aggregateId,
        `step-${input.idempotencyKey}`, 1, requestHash),
      requestHash,
      fence,
    });
  }) as Promise<{ status: string; step: AgentStepDto } | { status: "not_found" }>;
}

export async function requestAgentToolExecution(input: {
  runId: string;
  stepId?: string;
  toolName: string;
  toolVersion: string;
  argumentsHash: string;
  riskLevel: "low" | "sensitive";
  approved: boolean;
  idempotencyKey: string;
  now?: Date;
}): Promise<
  { status: string; execution: AgentToolExecutionDto } | { status: "not_found" }
> {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.requestAgentToolExecution(input);
  const run = await runtime.postgres.agentRuns.find(input.runId);
  if (!run) return { status: "not_found" as const };
  const aggregateType = run.sessionId ? "communication_session" : "agent_task";
  const aggregateId = run.sessionId ?? run.taskId;
  return withPostgresRepositoryFence({ aggregateType, aggregateId }, async (fence) => {
    const requestHash = repositoryRequestHash(input);
    return runtime.postgres.agentActions.requestTool({
      ...input,
      commandId: commandId(aggregateId, `tool-${input.idempotencyKey}`, 1, requestHash),
      requestHash,
      fence,
    });
  }) as Promise<
    { status: string; execution: AgentToolExecutionDto } | { status: "not_found" }
  >;
}

export async function updateAgentToolExecution(input: {
  executionId: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  providerOperationId?: string;
  resultSummary?: string;
  now?: Date;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.updateAgentToolExecution(input);
  const execution = await runtime.postgres.agentActions.findTool(input.executionId);
  if (!execution) return null;
  const run = await runtime.postgres.agentRuns.find(execution.runId);
  if (!run) return null;
  const aggregateType = run.sessionId ? "communication_session" : "agent_task";
  const aggregateId = run.sessionId ?? run.taskId;
  return withPostgresRepositoryFence({ aggregateType, aggregateId }, async (fence) => {
    const requestHash = repositoryRequestHash(input);
    const result = await runtime.postgres.agentActions.updateTool({
      ...input,
      runId: run.id,
      commandId: commandId(aggregateId, `tool-${input.status}`, 1, requestHash),
      requestHash,
      fence,
    });
    return hasExecution(result) ? result.execution : null;
  });
}

export function findAgentRun(runId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentRuns.find(runId)
    : Promise.resolve(legacy.findAgentRun(runId));
}

export function findAgentStepByIdempotency(runId: string, idempotencyKey: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentRuns.findStepByIdempotency(runId, idempotencyKey)
    : Promise.resolve(legacy.findAgentStepByIdempotency(runId, idempotencyKey));
}

export async function hasAgentStepDecision(
  runId: string,
  decisionType: AgentStepDecisionType,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.hasAgentStepDecision(runId, decisionType);
  return (await runtime.postgres.agentRuns.listExecutedSteps(runId))
    .some((step) => step.decisionType === decisionType);
}

export async function hasAgentRuntimeEvent(runId: string, event: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.hasAgentRuntimeEvent(runId, event);
  return hasAgentEvent(runId, (value) => value.event === event);
}

export async function hasAgentAmdCategory(runId: string, categories: string[]) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.hasAgentAmdCategory(runId, categories);
  return hasAgentEvent(runId, (value) => value.event === "amd_classified" &&
    typeof value.amdCategory === "string" && categories.includes(value.amdCategory));
}

export function findActiveAgentRun(taskId: string, mode: AgentExecutionMode) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentRuns.findActive(taskId, mode)
    : Promise.resolve(legacy.findActiveAgentRun(taskId, mode));
}

export function findAgentToolExecution(executionId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentActions.findTool(executionId)
    : Promise.resolve(legacy.findAgentToolExecution(executionId));
}

export function findAgentToolExecutionForTask(taskId: string, idempotencyKey: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentActions.findToolForTask(taskId, idempotencyKey)
    : Promise.resolve(legacy.findAgentToolExecutionForTask(taskId, idempotencyKey));
}

export function findAgentToolExecutionByProviderOperation(operationId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentActions.findToolByProviderOperation(operationId)
    : Promise.resolve(legacy.findAgentToolExecutionByProviderOperation(operationId));
}

export async function createAgentHandoff(input: {
  runId: string;
  reason: string;
  redactedSummary: string;
  target: "user" | "operator";
  idempotencyKey: string;
  now?: Date;
}): Promise<
  { status: string; handoff: AgentHandoffDto } | { status: "not_found" }
> {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return { status: "created" as const, handoff: legacy.createAgentHandoff(input) };
  }
  const run = await runtime.postgres.agentRuns.find(input.runId);
  if (!run) return { status: "not_found" as const };
  const aggregateId = run.sessionId ?? run.taskId;
  const aggregateType = run.sessionId ? "communication_session" : "agent_task";
  return withPostgresRepositoryFence({ aggregateType, aggregateId }, (fence) => {
    const requestHash = repositoryRequestHash(input);
    return runtime.postgres.agentActions.createHandoff({
      ...input,
      commandId: commandId(aggregateId,
        `handoff-${input.idempotencyKey}`, 1, requestHash),
      requestHash,
      fence,
    });
  }) as Promise<
    { status: string; handoff: AgentHandoffDto } | { status: "not_found" }
  >;
}

export function findRequestedAgentHandoff(
  runId: string,
  target?: "user" | "operator",
) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentHandoffs.findRequested(runId, target)
    : Promise.resolve(legacy.findRequestedAgentHandoff(runId, target));
}

export async function acceptAgentHandoff(
  runId: string,
  target: "user" | "operator" = "user",
  now = new Date(),
) {
  return transitionAgentHandoff(runId, target, "accepted", now);
}

export async function rejectAgentHandoff(
  runId: string,
  target: "user" | "operator" = "user",
  now = new Date(),
) {
  return transitionAgentHandoff(runId, target, "failed", now);
}

export function expireAgentHandoff(
  runId: string,
  target: "user" | "operator" = "user",
  now = new Date(),
) {
  return rejectAgentHandoff(runId, target, now);
}

async function transitionAgentHandoff(
  runId: string,
  target: "user" | "operator",
  status: "accepted" | "failed",
  now: Date,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return status === "accepted"
      ? legacy.acceptAgentHandoff(runId, target, now)
      : legacy.rejectAgentHandoff(runId, target, now);
  }
  const run = await runtime.postgres.agentRuns.find(runId);
  if (!run) return null;
  const handoff = await runtime.postgres.agentHandoffs.findRequested(runId, target) ??
    await runtime.postgres.agentHandoffs.findLatest(runId, target, status);
  if (!handoff) return null;
  const aggregateId = run.sessionId ?? run.taskId;
  const aggregateType = run.sessionId ? "communication_session" : "agent_task";
  const requestHash = repositoryRequestHash({ runId, handoffId: handoff.id, status });
  const result = await withPostgresRepositoryFence(
    { aggregateType, aggregateId },
    (fence) => runtime.postgres.agentHandoffs.transition({
      handoffId: handoff.id, runId, status, now,
      commandId: commandId(aggregateId,
        `handoff-${status}-${handoff.id}`, 1, requestHash),
      requestHash, fence,
    }),
  );
  return hasHandoff(result) ? result.handoff : null;
}

async function hasAgentEvent(
  runId: string,
  predicate: (value: Record<string, unknown>) => boolean,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return false;
  return (await runtime.postgres.agentRuns.listExecutedSteps(runId)).some((step) => {
    if (!step.outputSummary) return false;
    try { return predicate(JSON.parse(step.outputSummary) as Record<string, unknown>); }
    catch { return false; }
  });
}

function commandId(id: string, operation: string, version: number, requestHash: string) {
  return repositoryCommandId({ aggregateId: id, operation: `agent-${operation}`,
    version, requestHash });
}

function hasRun(value: unknown): value is { run: NonNullable<Awaited<ReturnType<typeof findAgentRun>>> } {
  return Boolean(value && typeof value === "object" && "run" in value &&
    (value as { run?: unknown }).run);
}

function hasExecution(value: unknown): value is {
  execution: NonNullable<Awaited<ReturnType<typeof findAgentToolExecution>>>;
} {
  return Boolean(value && typeof value === "object" && "execution" in value &&
    (value as { execution?: unknown }).execution);
}

function hasHandoff(value: unknown): value is { handoff: { id: string } } {
  return Boolean(value && typeof value === "object" && "handoff" in value &&
    (value as { handoff?: { id?: unknown } }).handoff?.id);
}
