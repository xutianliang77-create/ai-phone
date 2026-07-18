import { randomUUID } from "node:crypto";
import type {
  AuthorizeAiCallingAgentRequest,
  CancelAiCallingAgentDraftRequest,
  CreateAiCallingAgentDraftRequest,
  RequestAiCallingAgentTakeoverRequest,
  VoiceAgentStructuredResultDto,
} from "@translation/contracts";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { releaseUsageHold } from "../usage/usage-hold-runtime.service.js";
import { classifyAgentCallRisk } from "./agent-call-risk.js";
import type { AgentCallRecord } from "./agent-call-record.js";
import {
  isValidAgentCallPhone,
  normalizeAgentCallPhone,
} from "./agent-call-gray-policy.js";
import {
  cleanText,
  defaultScript,
  isAgentCallCancellable,
  isScenario,
} from "./agent-call-repository-helpers.js";
import * as legacy from "./agent-calls.repository.js";
import {
  createAgentHandoff,
  findActiveAgentRun,
} from "./agent-orchestration-runtime.repository.js";

export async function createAgentCallDraft(
  userId: string,
  request: CreateAiCallingAgentDraftRequest,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.createAgentCallDraft(userId, request);
  const draft = buildDraft(userId, request);
  if (!draft) return null;
  return withPostgresRepositoryFence(
    { aggregateType: "agent_task", aggregateId: draft.id },
    async (fence) => {
      const requestHash = repositoryRequestHash(draft);
      const result = await runtime.postgres.agentTasks.create({
        record: draft,
        idempotencyKey: `create:${draft.id}`,
        commandId: commandId(draft.id, "create", 1, requestHash),
        requestHash,
        fence,
      });
      return "task" in result ? result.task : null;
    },
  );
}

export async function listAgentCallDrafts(userId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentTasks.listOwned(userId)
    : legacy.listAgentCallDrafts(userId);
}

export async function findAgentCallDraft(userId: string, draftId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentTasks.findOwned(userId, draftId)
    : legacy.findAgentCallDraft(userId, draftId);
}

export async function findAgentCallDraftById(draftId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentTasks.find(draftId)
    : legacy.findAgentCallDraftById(draftId);
}

export async function findAgentCallDraftByCallReference(input: {
  userId?: string;
  callId?: string;
  providerCallId?: string;
}) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentTasks.findByCallReference(input)
    : legacy.findAgentCallDraftByCallReference(input);
}

export async function authorizeAgentCallDraft(
  userId: string,
  draftId: string,
  request: AuthorizeAiCallingAgentRequest,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.authorizeAgentCallDraft(userId, draftId, request);
  }
  const current = await runtime.postgres.agentTasks.findOwned(userId, draftId);
  const prepared = authorize(current, request);
  if (prepared.status !== "ready") return prepared;
  const result = await mutateAgentCallTask(prepared.draft, "authorize", request, (next) => {
    const result = authorize(next, request);
    return result.status === "ready" ? result.next : null;
  }, "agent.task.authorized", "authorized");
  return hasTask(result)
    ? { status: "authorized" as const, draft: result.task }
    : { status: "invalid_state" as const, draft: prepared.draft };
}

export async function requestAgentCallTakeover(
  userId: string,
  draftId: string,
  request: RequestAiCallingAgentTakeoverRequest,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.requestAgentCallTakeover(userId, draftId, request);
  }
  const current = await runtime.postgres.agentTasks.findOwned(userId, draftId);
  if (!current) return null;
  if (!["requires_human_takeover", "in_progress", "takeover_requested"]
    .includes(current.status)) return current;
  const result = await mutateAgentCallTask(current, "takeover", request, (next) => {
    const now = new Date().toISOString();
    next.status = "takeover_requested";
    next.takeoverReadyAt = undefined;
    next.takeoverResolvedAt = undefined;
    next.takeoverReason = cleanText(request.reason, 200) || "user_requested";
    next.takeoverRequestedAt = now;
    next.updatedAt = now;
    return next;
  }, "agent.task.takeover_requested", "updated");
  const task = hasTask(result) ? result.task : current;
  const run = await findActiveAgentRun(task.id, "autonomous");
  if (run) await createAgentHandoff({
    runId: run.id,
    reason: task.takeoverReason ?? "user_requested",
    redactedSummary: "User requested takeover",
    target: "user",
    idempotencyKey: `takeover:${task.id}:${task.takeoverRequestedAt ?? task.updatedAt}`,
  });
  return task;
}

export async function cancelAgentCallDraft(
  userId: string,
  draftId: string,
  request: CancelAiCallingAgentDraftRequest,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.cancelAgentCallDraft(userId, draftId, request);
  }
  const current = await runtime.postgres.agentTasks.findOwned(userId, draftId);
  if (!current) return { status: "not_found" as const };
  if (!isAgentCallCancellable(current.status)) {
    return { status: "invalid_state" as const, draft: current };
  }
  const releaseHeldUsage = current.status === "queued" && Boolean(current.callId);
  const result = await mutateAgentCallTask(current, "cancel", request, (next) => {
    if (!isAgentCallCancellable(next.status)) return null;
    const now = new Date().toISOString();
    next.status = "cancelled";
    next.cancellationReason = cleanText(request.reason, 200) || "user_cancelled";
    next.cancelledAt = now;
    next.updatedAt = now;
    if (releaseHeldUsage) next.usageSettledAt = now;
    return next;
  }, "agent.task.cancelled", "cancelled");
  if (releaseHeldUsage && current.callId) await releaseUsageHold(userId, current.callId);
  if (!hasTask(result)) return { status: "mutation_conflict" as const };
  return { status: "cancelled" as const, draft: result.task };
}

export async function markAgentCallTakeoverReady(draftId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.markAgentCallTakeoverReady(draftId);
  const current = await runtime.postgres.agentTasks.find(draftId);
  if (!current || current.status !== "takeover_requested") return current;
  const now = new Date().toISOString();
  const result = await mutateAgentCallTask(current, "takeover-ready", {}, (next) => {
    if (next.status !== "takeover_requested") return null;
    next.takeoverReadyAt ??= now;
    next.updatedAt = next.takeoverReadyAt;
    return next;
  }, "agent.task.takeover_ready", "updated");
  return hasTask(result) ? result.task : current;
}

export async function resumeAgentCallAfterTakeover(userId: string, draftId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.resumeAgentCallAfterTakeover(userId, draftId);
  const current = await runtime.postgres.agentTasks.findOwned(userId, draftId);
  if (!current || current.status !== "takeover_requested") return null;
  const now = new Date().toISOString();
  const result = await mutateAgentCallTask(current, "takeover-resume", {}, (next) => {
    if (next.status !== "takeover_requested") return null;
    next.status = "in_progress";
    next.takeoverResolvedAt ??= now;
    next.updatedAt = next.takeoverResolvedAt;
    return next;
  }, "agent.task.in_progress", "updated");
  return hasTask(result) ? result.task : null;
}

export async function resolveAgentCallTakeover(draftId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.resolveAgentCallTakeover(draftId);
  const current = await runtime.postgres.agentTasks.find(draftId);
  if (!current || current.status !== "takeover_requested") return null;
  const now = new Date().toISOString();
  const result = await mutateAgentCallTask(current, "takeover-resolve", {}, (next) => {
    if (next.status !== "takeover_requested") return null;
    next.takeoverResolvedAt = now;
    next.updatedAt = now;
    return next;
  }, "agent.task.takeover_resolved", "updated");
  return hasTask(result) ? result.task : null;
}

export async function recordAgentCallRuntimeResult(
  draftId: string,
  value: VoiceAgentStructuredResultDto,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.recordAgentCallRuntimeResult(draftId, value);
  const current = await runtime.postgres.agentTasks.find(draftId);
  if (!current) return null;
  const result = await mutateAgentCallTask(current, "runtime-result", value, (next) => {
    next.resultSummary = cleanText(value.summary, 800) || next.resultSummary;
    next.nextStep = cleanText(value.nextStep, 300) ||
      cleanText(value.unresolvedItems.join("；"), 300) || next.nextStep;
    next.updatedAt = new Date().toISOString();
    return next;
  }, "agent.task.runtime_result", "updated");
  return hasTask(result) ? result.task : current;
}

function buildDraft(
  userId: string,
  request: CreateAiCallingAgentDraftRequest,
): AgentCallRecord | null {
  const objective = cleanText(request.objective, 500);
  if (!objective || !isScenario(request.scenario)) return null;
  const targetPhone = cleanText(request.targetPhone, 32);
  if (targetPhone && !isValidAgentCallPhone(targetPhone)) return null;
  const suggestedScript = cleanText(request.suggestedScript, 800) || defaultScript(objective);
  const risk = classifyAgentCallRisk({ objective, suggestedScript });
  const now = new Date().toISOString();
  return {
    id: randomUUID(), userId, scenario: request.scenario,
    status: risk.riskLevel === "low" ? "draft" : "requires_human_takeover",
    objective, suggestedScript, language: request.language === "en" ? "en" : "zh",
    riskLevel: risk.riskLevel, riskReasons: risk.riskReasons,
    createdAt: now, updatedAt: now,
    ...(cleanText(request.targetName, 80)
      ? { targetName: cleanText(request.targetName, 80) } : {}),
    ...(targetPhone ? { targetPhone: normalizeAgentCallPhone(targetPhone) } : {}),
  };
}

function authorize(current: AgentCallRecord | null, request: AuthorizeAiCallingAgentRequest) {
  if (!current) return { status: "not_found" as const };
  if (!request.userConfirmed || !cleanText(request.consentPromptVersion, 80)) {
    return { status: "invalid" as const };
  }
  if (current.status === "cancelled") return { status: "cancelled" as const, draft: current };
  if (current.status !== "draft" && current.status !== "requires_human_takeover") {
    return { status: "invalid_state" as const, draft: current };
  }
  if (current.status === "requires_human_takeover" ||
    current.riskLevel === "requires_human_takeover") {
    return { status: "requires_human_takeover" as const, draft: current };
  }
  const now = new Date().toISOString();
  const next = structuredClone(current);
  next.status = "authorized";
  next.consentPromptVersion = cleanText(request.consentPromptVersion, 80);
  next.recipientDisclosureConfirmed = request.recipientDisclosureConfirmed === true;
  next.disclosurePromptVersion = cleanText(request.disclosurePromptVersion, 80) || undefined;
  next.authorizedAt = now;
  next.updatedAt = now;
  return { status: "ready" as const, draft: current, next };
}

export async function mutateAgentCallTask(
  current: AgentCallRecord,
  operation: string,
  payload: unknown,
  mutate: (current: AgentCallRecord) => AgentCallRecord | null,
  eventType: string,
  successStatus: string,
  bindSessionId?: string,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    throw new Error("Agent task mutation requires the PostgreSQL runtime");
  }
  const requestHash = repositoryRequestHash({ taskId: current.id, payload });
  const sessionId = current.callId ?? bindSessionId;
  const aggregateType = sessionId ? "communication_session" : "agent_task";
  const aggregateId = sessionId ?? current.id;
  return withPostgresRepositoryFence({ aggregateType, aggregateId }, async (fence) => {
    const result = await runtime.postgres.agentTasks.update({
      taskId: current.id, userId: current.userId,
      ...(bindSessionId ? { bindSessionId } : {}),
      commandId: commandId(current.id, operation, 1, requestHash),
      commandType: `agent.task.${operation}`, requestHash, eventType, fence, mutate,
    });
    return "task" in result ? { status: successStatus, task: result.task } : result;
  });
}

function commandId(id: string, operation: string, version: number, requestHash: string) {
  return repositoryCommandId({ aggregateId: id, operation: `agent-task-${operation}`,
    version, requestHash });
}

function hasTask(value: unknown): value is { task: AgentCallRecord } {
  return Boolean(value && typeof value === "object" && "task" in value &&
    (value as { task?: unknown }).task);
}
