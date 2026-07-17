import type { UpdateAiCallingAgentCallStatusRequest } from "@translation/contracts";
import {
  consumeSeconds,
  releaseUsageHold,
  settleUsageHold,
} from "../usage/usage.service.js";
import type { AgentCallRecord } from "./agent-call-record.js";
import {
  cleanText,
  isTerminalWorkerStatus,
  isWorkerStatus,
  normalizedSeconds,
} from "./agent-call-repository-helpers.js";
import {
  findActiveAgentRun,
  updateAgentRun,
} from "./agent-orchestration.repository.js";

export function applyAgentCallStatusUpdate(
  userId: string,
  draft: AgentCallRecord,
  request: UpdateAiCallingAgentCallStatusRequest,
) {
  if (!isWorkerStatus(request.status)) return { status: "invalid" as const };
  if (draft.status === "cancelled") {
    const consumedSeconds = normalizedSeconds(request.consumedSeconds) ?? 0;
    draft.consumedSeconds = consumedSeconds;
    const now = new Date().toISOString();
    settleUsageOnce(userId, draft, {
      billableSeconds: request.status === "failed" ? 0 : consumedSeconds,
      releaseHold: request.status === "failed",
      settledAt: now,
    });
    draft.updatedAt = now;
    const run = findActiveAgentRun(draft.id, "autonomous");
    if (run) updateAgentRun({ runId: run.id, status: "cancelled" });
    return { status: "updated" as const, draft };
  }
  if (!["queued", "dispatching", "reconciliation_required", "in_progress",
    "takeover_requested"].includes(draft.status)) {
    return { status: "invalid_state" as const, draft };
  }
  const now = new Date().toISOString();
  draft.status = request.status;
  if (request.status === "in_progress") draft.startedAt = draft.startedAt ?? now;
  if (request.status === "completed") draft.completedAt = now;
  if (request.status === "failed") draft.failedAt = now;
  const consumedSeconds = normalizedSeconds(request.consumedSeconds);
  if (consumedSeconds !== null) draft.consumedSeconds = consumedSeconds;
  if (isTerminalWorkerStatus(request.status)) {
    settleUsageOnce(userId, draft, {
      billableSeconds: request.status === "failed" ? 0 : consumedSeconds ?? 0,
      releaseHold: request.status === "failed",
      settledAt: now,
    });
  }
  draft.providerCallId = cleanText(request.providerCallId, 120) || draft.providerCallId;
  draft.resultSummary = cleanText(request.resultSummary, 800) || draft.resultSummary;
  draft.failureReason = cleanText(request.failureReason, 300) || draft.failureReason;
  draft.nextStep = cleanText(request.nextStep, 300) || draft.nextStep;
  draft.updatedAt = now;
  const run = findActiveAgentRun(draft.id, "autonomous");
  if (run) {
    updateAgentRun({
      runId: run.id,
      status: request.status === "in_progress" ? "running"
        : request.status === "completed" ? "completed" : "failed",
      failureCode: request.status === "failed" ? draft.failureReason : undefined,
    });
  }
  return { status: "updated" as const, draft };
}

function settleUsageOnce(
  userId: string,
  draft: AgentCallRecord,
  options: { billableSeconds: number; releaseHold: boolean; settledAt: string },
) {
  if (draft.usageSettledAt) return;
  const sessionId = draft.callId ?? draft.id;
  if (options.billableSeconds > 0) {
    consumeSeconds(userId, options.billableSeconds, undefined, {
      note: "agent_call_usage",
      sessionId,
      idempotencyKey: `settle:${sessionId}`,
    });
  }
  if (options.releaseHold) releaseUsageHold(userId, sessionId);
  else settleUsageHold(userId, sessionId, options.billableSeconds);
  draft.usageSettledAt = options.settledAt;
}
