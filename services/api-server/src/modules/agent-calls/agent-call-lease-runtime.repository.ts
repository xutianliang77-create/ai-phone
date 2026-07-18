import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  CommunicationProvider,
  UpdateAiCallingAgentCallStatusRequest,
} from "@translation/contracts";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import {
  releaseUsageHold,
  settleUsageHold,
} from "../usage/usage-hold-runtime.service.js";
import type { AgentCallRecord } from "./agent-call-record.js";
import {
  cleanText,
  normalizedSeconds,
} from "./agent-call-repository-helpers.js";
import {
  isValidAgentCallStatusUpdate,
  terminalReplayRequest,
} from "./agent-call-status-contract.js";
import {
  findAgentCallDraftById,
  mutateAgentCallTask,
} from "./agent-calls-runtime.repository.js";
import * as legacy from "./agent-call-lease.repository.js";
import {
  findActiveAgentRun,
  findAgentToolExecutionForTask,
  updateAgentRun,
  updateAgentToolExecution,
} from "./agent-orchestration-runtime.repository.js";

export async function claimQueuedAgentCalls(input: {
  workerId: string;
  limit: number;
  leaseSeconds: number;
  now?: Date;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.claimQueuedAgentCalls(input);
  const provider = agentCallProvider();
  if (!provider) return { status: "not_configured" as const, claims: [] };
  const candidates = await runtime.postgres.agentTasks.listQueued(boundedLimit(input.limit));
  const claims = [];
  for (const draft of candidates) {
    const claim = await claimOne(draft, provider, input);
    if (claim) claims.push(claim);
  }
  return { status: "claimed" as const, claims };
}

export async function updateClaimedAgentCall(input: {
  draftId: string;
  workerId: string;
  leaseToken: string;
  request: UpdateAiCallingAgentCallStatusRequest;
  now?: Date;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.updateClaimedAgentCall(input);
  const draft = await findAgentCallDraftById(input.draftId);
  if (!draft) return { status: "not_found" as const };
  if (!isValidAgentCallStatusUpdate(input.request)) {
    return { status: "invalid" as const };
  }
  if (replayedLease(draft, input.workerId, input.leaseToken)) {
    const replay = terminalReplayRequest(draft, input.request);
    if (!replay) return { status: "invalid_state" as const, draft };
    await finalizeAgentCallStatus(draft, replay, input.now);
    return { status: "updated" as const, draft };
  }
  if (!verifyAgentCallLease(draft, input.workerId, input.leaseToken, input.now)) {
    return { status: "lease_conflict" as const, draft };
  }
  const changed = await mutateAgentCallTask(
    draft,
    `worker-${input.request.status}`,
    input.request,
    (next) => applyAgentCallStatusMutation(next, input.request, input.now),
    `agent.task.${input.request.providerOperationStatus === "unknown"
      ? "reconciliation_required" : input.request.status}`,
    "updated",
  );
  if (!hasTask(changed)) return { status: "invalid_state" as const, draft };
  await finalizeAgentCallStatus(changed.task, input.request, input.now);
  return { status: "updated" as const, draft: changed.task };
}

export function verifyAgentCallLease(
  draft: AgentCallRecord,
  workerId: string,
  token: string,
  now = new Date(),
) {
  if (!["dispatching", "in_progress"].includes(draft.status) ||
    draft.workerLeaseOwner !== workerId || !draft.workerLeaseTokenHash ||
    Date.parse(draft.workerLeaseExpiresAt ?? "") <= now.getTime()) return false;
  return secureHashMatches(draft.workerLeaseTokenHash, token);
}

async function claimOne(
  draft: AgentCallRecord,
  provider: CommunicationProvider,
  input: { workerId: string; leaseSeconds: number; now?: Date },
) {
  if (!draft.callId || !draft.targetPhone) return null;
  const now = input.now ?? new Date();
  const operation = await beginProviderOperation({
    sessionId: draft.callId,
    provider,
    operationType: "sip_outbound",
    operationKey: draft.id,
    idempotencyKey: `agent-dial:${draft.callId}`,
    requestHash: dialRequestHash(draft),
    now,
  });
  if (!["started", "replayed"].includes(operation.status)) {
    await failDialGate(draft, operation.operation.id, now);
    return null;
  }
  const leaseToken = randomUUID();
  const expiresAt = new Date(now.getTime() + input.leaseSeconds * 1_000).toISOString();
  const changed = await mutateAgentCallTask(
    draft,
    "claim",
    { workerId: input.workerId, operationId: operation.operation.id },
    (next) => {
      if (next.status !== "queued") return null;
      next.status = "dispatching";
      next.workerLeaseOwner = input.workerId;
      next.workerLeaseTokenHash = tokenHash(leaseToken);
      next.workerLeaseExpiresAt = expiresAt;
      next.workerLeaseAttempt = (next.workerLeaseAttempt ?? 0) + 1;
      next.providerOperationId = operation.operation.id;
      next.updatedAt = now.toISOString();
      return next;
    },
    "agent.task.dispatching",
    "claimed",
  );
  if (!hasTask(changed)) return null;
  await updateDialTool(changed.task, "running");
  return {
    draft: changed.task,
    workerId: input.workerId,
    leaseToken,
    leaseExpiresAt: expiresAt,
    attempt: changed.task.workerLeaseAttempt ?? 1,
    dialIdempotencyKey: `agent-dial:${draft.callId}`,
  };
}

export function applyAgentCallStatusMutation(
  draft: AgentCallRecord,
  request: UpdateAiCallingAgentCallStatusRequest,
  nowValue?: Date,
) {
  if (request.providerOperationStatus === "unknown") {
    const now = (nowValue ?? new Date()).toISOString();
    draft.status = "reconciliation_required";
    draft.failureReason = cleanText(request.failureReason, 300) ||
      "provider_operation_unknown";
    draft.nextStep = cleanText(request.nextStep, 300) ||
      "人工核对服务商记录；确认未拨号前不得重试。";
    draft.workerLeaseExpiresAt = undefined;
    draft.updatedAt = now;
    return draft;
  }
  if (draft.status === "cancelled") {
    const now = (nowValue ?? new Date()).toISOString();
    const consumed = normalizedSeconds(request.consumedSeconds);
    if (consumed !== null) draft.consumedSeconds = consumed;
    draft.providerCallId = cleanText(request.providerCallId, 120) || draft.providerCallId;
    draft.failureReason = cleanText(request.failureReason, 300) || draft.failureReason;
    draft.workerLeaseExpiresAt = undefined;
    draft.updatedAt = now;
    return draft;
  }
  if (!["queued", "dispatching", "reconciliation_required", "in_progress",
    "takeover_requested"].includes(draft.status)) return null;
  const now = (nowValue ?? new Date()).toISOString();
  draft.status = request.status;
  if (request.status === "in_progress") draft.startedAt ??= now;
  if (request.status === "completed") draft.completedAt = now;
  if (request.status === "failed") draft.failedAt = now;
  const consumed = normalizedSeconds(request.consumedSeconds);
  if (consumed !== null) draft.consumedSeconds = consumed;
  draft.providerCallId = cleanText(request.providerCallId, 120) || draft.providerCallId;
  draft.resultSummary = cleanText(request.resultSummary, 800) || draft.resultSummary;
  draft.failureReason = cleanText(request.failureReason, 300) || draft.failureReason;
  draft.nextStep = cleanText(request.nextStep, 300) || draft.nextStep;
  if (request.status !== "in_progress") draft.workerLeaseExpiresAt = undefined;
  draft.updatedAt = now;
  return draft;
}

export async function finalizeAgentCallStatus(
  draft: AgentCallRecord,
  request: UpdateAiCallingAgentCallStatusRequest,
  now?: Date,
) {
  if (draft.providerOperationId) {
    const desired = request.providerOperationStatus ??
      (request.status === "in_progress" ? "accepted"
        : request.status === "completed" ? "succeeded" : "failed");
    if (desired === "succeeded") {
      await updateProviderOperation({ operationId: draft.providerOperationId,
        status: "accepted", externalOperationId: request.providerCallId, now });
    }
    await updateProviderOperation({
      operationId: draft.providerOperationId,
      status: desired,
      externalOperationId: request.providerCallId,
      errorClass: desired === "failed" || desired === "unknown"
        ? request.failureReason : undefined,
      now,
    });
  }
  if (request.providerOperationStatus !== "unknown" &&
    ["completed", "failed"].includes(request.status) && draft.callId) {
    if (request.status === "failed") await releaseUsageHold(draft.userId, draft.callId);
    else await settleUsageHold(draft.userId, draft.callId,
      normalizedSeconds(request.consumedSeconds) ?? 0);
    if (!draft.usageSettledAt) {
      const settledAt = (now ?? new Date()).toISOString();
      const settled = await mutateAgentCallTask(
        draft, "usage-settled", { status: request.status, settledAt },
        (next) => { next.usageSettledAt ??= settledAt; return next; },
        "agent.task.usage_settled", "updated",
      );
      if (hasTask(settled)) draft.usageSettledAt = settled.task.usageSettledAt;
    }
  }
  const run = await findActiveAgentRun(draft.id, "autonomous");
  if (run && request.providerOperationStatus !== "unknown") {
    await updateAgentRun({
      runId: run.id,
      status: draft.status === "cancelled" ? "cancelled"
        : request.status === "in_progress" ? "running"
        : request.status === "completed" ? "completed" : "failed",
      failureCode: request.status === "failed" ? draft.failureReason : undefined,
      now,
    });
  }
  await updateDialTool(draft,
    request.providerOperationStatus === "unknown" ? "running"
      : request.status === "completed" ? "succeeded"
      : request.status === "failed" ? "failed" : "running",
    request.providerOperationStatus === "unknown"
      ? "Provider result requires reconciliation" : undefined);
}

async function failDialGate(draft: AgentCallRecord, operationId: string, now: Date) {
  const changed = await mutateAgentCallTask(
    draft, "dial-gate-conflict", { operationId }, (next) => {
      next.status = "reconciliation_required";
      next.providerOperationId = operationId;
      next.failureReason = "single_dial_gate_conflict";
      next.nextStep = "人工核对既有拨号操作；不得自动重拨。";
      next.updatedAt = now.toISOString();
      return next;
    }, "agent.task.reconciliation_required", "updated",
  );
  if (hasTask(changed)) await updateDialTool(changed.task, "failed", "Single dial gate conflict");
}

async function updateDialTool(
  draft: AgentCallRecord,
  status: "running" | "succeeded" | "failed",
  resultSummary?: string,
) {
  if (!draft.callId) return;
  const execution = await findAgentToolExecutionForTask(
    draft.id, `agent-dial:${draft.callId}`,
  );
  if (!execution) return;
  await updateAgentToolExecution({
    executionId: execution.id,
    status,
    providerOperationId: draft.providerOperationId,
    resultSummary,
  });
}

function replayedLease(draft: AgentCallRecord, workerId: string, token: string) {
  return !["dispatching", "in_progress"].includes(draft.status) &&
    draft.workerLeaseOwner === workerId && Boolean(draft.workerLeaseTokenHash) &&
    secureHashMatches(draft.workerLeaseTokenHash!, token);
}

function secureHashMatches(expectedHash: string, token: string) {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(tokenHash(token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function dialRequestHash(draft: AgentCallRecord) {
  return createHash("sha256").update(JSON.stringify({
    draftId: draft.id,
    callId: draft.callId,
    targetHash: tokenHash(draft.targetPhone ?? ""),
    consentPromptVersion: draft.consentPromptVersion,
  })).digest("hex");
}

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function agentCallProvider(): CommunicationProvider | null {
  const value = process.env.AGENT_CALL_PROVIDER_ADAPTER;
  return value === "livekit_sip" || value === "pstn_http" || value === "pstn_fonoster"
    ? value : null;
}

function boundedLimit(value: number) {
  return Number.isInteger(value) ? Math.max(1, Math.min(value, 20)) : 5;
}

function hasTask(value: unknown): value is { task: AgentCallRecord } {
  return Boolean(value && typeof value === "object" && "task" in value &&
    (value as { task?: unknown }).task);
}
