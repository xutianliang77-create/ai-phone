import { randomUUID } from "node:crypto";
import type {
  AuthorizeAiCallingAgentRequest,
  CancelAiCallingAgentDraftRequest,
  CreateAiCallingAgentDraftRequest,
  PstnAgentCallWebhookRequest,
  RequestAiCallingAgentTakeoverRequest,
  StartAiCallingAgentCallRequest,
  UpdateAiCallingAgentCallStatusRequest,
} from "@translation/contracts";
import { getStoreSnapshot, persistStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  consumeSeconds,
  createUsageHold,
  releaseUsageHold,
  settleUsageHold,
} from "../usage/usage.service.js";
import { AGENT_CALL_MINIMUM_START_SECONDS } from "./agent-call-usage-readiness.js";
import { classifyAgentCallRisk } from "./agent-call-risk.js";
import type { AgentCallRecord } from "./agent-call-record.js";

export function createAgentCallDraft(
  userId: string,
  request: CreateAiCallingAgentDraftRequest,
) {
  const objective = cleanText(request.objective, 500);
  if (!objective || !isScenario(request.scenario)) return null;
  const suggestedScript = cleanText(request.suggestedScript, 800) ||
    defaultScript(objective);
  const risk = classifyAgentCallRisk({ objective, suggestedScript });
  const now = new Date().toISOString();
  const draft: AgentCallRecord = {
    id: randomUUID(),
    userId,
    scenario: request.scenario,
    status: risk.riskLevel === "low" ? "draft" : "requires_human_takeover",
    objective,
    suggestedScript,
    language: request.language === "en" ? "en" : "zh",
    riskLevel: risk.riskLevel,
    riskReasons: risk.riskReasons,
    createdAt: now,
    updatedAt: now,
    ...(cleanText(request.targetName, 80) ? { targetName: cleanText(request.targetName, 80) } : {}),
    ...(cleanText(request.targetPhone, 32) ? { targetPhone: cleanText(request.targetPhone, 32) } : {}),
  };
  getStoreSnapshot().agentCallDrafts.push(draft);
  persistStoreSnapshot();
  return draft;
}

export function listAgentCallDrafts(userId: string) {
  return getStoreSnapshot().agentCallDrafts
    .filter((draft) => draft.userId === userId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function listQueuedAgentCallDrafts(userId: string, limit = 10) {
  return getStoreSnapshot().agentCallDrafts
    .filter((draft) => draft.userId === userId && draft.status === "queued")
    .sort((left, right) => (left.queuedAt ?? left.updatedAt).localeCompare(
      right.queuedAt ?? right.updatedAt,
    ))
    .slice(0, Math.max(1, Math.min(limit, 50)));
}

export function listQueuedAgentCallDraftsForWorker(limit = 10) {
  return getStoreSnapshot().agentCallDrafts
    .filter((draft) => draft.status === "queued")
    .sort((left, right) => (left.queuedAt ?? left.updatedAt).localeCompare(
      right.queuedAt ?? right.updatedAt,
    ))
    .slice(0, Math.max(1, Math.min(limit, 50)));
}

export function findAgentCallDraft(userId: string, draftId: string) {
  return getStoreSnapshot().agentCallDrafts
    .find((draft) => draft.userId === userId && draft.id === draftId) ?? null;
}

export function findAgentCallDraftById(draftId: string) {
  return getStoreSnapshot().agentCallDrafts
    .find((draft) => draft.id === draftId) ?? null;
}

export function findAgentCallDraftByCallReference(input: {
  userId?: string;
  callId?: string;
  providerCallId?: string;
}) {
  const callId = cleanText(input.callId, 120);
  const providerCallId = cleanText(input.providerCallId, 120);
  if (!callId && !providerCallId) return null;
  return getStoreSnapshot().agentCallDrafts.find((draft) =>
    (!input.userId || draft.userId === input.userId) &&
    ((callId && draft.callId === callId) ||
      (providerCallId && draft.providerCallId === providerCallId))
  ) ?? null;
}

export function authorizeAgentCallDraft(
  userId: string,
  draftId: string,
  request: AuthorizeAiCallingAgentRequest,
) {
  const draft = findAgentCallDraft(userId, draftId);
  if (!draft) return { status: "not_found" as const };
  if (!request.userConfirmed || !cleanText(request.consentPromptVersion, 80)) {
    return { status: "invalid" as const };
  }
  if (draft.status === "cancelled") {
    return { status: "cancelled" as const, draft };
  }
  if (draft.status !== "draft" && draft.status !== "requires_human_takeover") {
    return { status: "invalid_state" as const, draft };
  }
  if (draft.status === "requires_human_takeover" ||
    draft.riskLevel === "requires_human_takeover") {
    return { status: "requires_human_takeover" as const, draft };
  }
  draft.status = "authorized";
  draft.consentPromptVersion = cleanText(request.consentPromptVersion, 80);
  draft.authorizedAt = new Date().toISOString();
  draft.updatedAt = draft.authorizedAt;
  persistStoreSnapshot();
  return { status: "authorized" as const, draft };
}

export function requestAgentCallTakeover(
  userId: string,
  draftId: string,
  request: RequestAiCallingAgentTakeoverRequest,
) {
  const draft = findAgentCallDraft(userId, draftId);
  if (!draft) return null;
  const now = new Date().toISOString();
  draft.status = "takeover_requested";
  draft.takeoverReason = cleanText(request.reason, 200) || "user_requested";
  draft.takeoverRequestedAt = now;
  draft.updatedAt = now;
  persistStoreSnapshot();
  return draft;
}

export function cancelAgentCallDraft(
  userId: string,
  draftId: string,
  request: CancelAiCallingAgentDraftRequest,
) {
  const draft = findAgentCallDraft(userId, draftId);
  if (!draft) return { status: "not_found" as const };
  if (!isPreAuthorizationCancellable(draft.status)) {
    return { status: "invalid_state" as const, draft };
  }
  const now = new Date().toISOString();
  draft.status = "cancelled";
  draft.cancellationReason = cleanText(request.reason, 200) || "user_cancelled_before_authorization";
  draft.cancelledAt = now;
  draft.updatedAt = now;
  persistStoreSnapshot();
  return { status: "cancelled" as const, draft };
}

export function startAgentCallDraft(
  userId: string,
  draftId: string,
  request: StartAiCallingAgentCallRequest,
) {
  const draft = findAgentCallDraft(userId, draftId);
  if (!draft) return { status: "not_found" as const };
  if (isStartedStatus(draft.status)) return { status: "already_started" as const, draft };
  if (draft.status !== "authorized") return { status: "invalid_state" as const, draft };
  if (!cleanText(draft.targetPhone, 32)) return { status: "missing_target" as const, draft };
  if (cleanText(request.consentPromptVersion, 80) &&
    request.consentPromptVersion !== draft.consentPromptVersion) {
    return { status: "invalid_consent" as const, draft };
  }

  const now = new Date().toISOString();
  const callId = draft.callId ?? randomUUID();
  const hold = createUsageHold(userId, AGENT_CALL_MINIMUM_START_SECONDS, undefined, {
    sessionId: callId,
    idempotencyKey: `hold:${callId}`,
    note: "agent_call_session_hold",
    ttlSeconds: 2 * 60 * 60,
  });
  if (hold.status !== "held") {
    return { status: "insufficient_balance" as const, draft, usage: hold };
  }
  draft.status = "queued";
  draft.callId = callId;
  draft.executionProvider = cleanText(process.env.PSTN_PROVIDER, 80) || "domestic_bridge";
  draft.queuedAt = now;
  draft.updatedAt = now;
  persistStoreSnapshot();
  return { status: "queued" as const, draft };
}

export function updateAgentCallExecutionStatus(
  userId: string,
  draftId: string,
  request: UpdateAiCallingAgentCallStatusRequest,
) {
  const draft = findAgentCallDraft(userId, draftId);
  if (!draft) return { status: "not_found" as const };
  const result = applyStatusUpdate(userId, draft, request);
  if (result.status === "updated") persistStoreSnapshot();
  return result;
}

export function updateAgentCallExecutionStatusById(
  draftId: string,
  request: UpdateAiCallingAgentCallStatusRequest,
) {
  const draft = findAgentCallDraftById(draftId);
  if (!draft) return { status: "not_found" as const };
  const result = applyStatusUpdate(draft.userId, draft, request);
  if (result.status === "updated") persistStoreSnapshot();
  return result;
}

export function updateAgentCallFromPstnWebhook(
  request: PstnAgentCallWebhookRequest,
) {
  const eventId = cleanText(request.eventId, 120);
  if (!eventId) return { status: "invalid" as const };
  const draft = findAgentCallDraftByCallReference({
    callId: request.callId,
    providerCallId: request.providerCallId,
  });
  if (!draft) return { status: "not_found" as const };
  const seen = draft.providerWebhookEventIds ?? [];
  if (seen.includes(eventId)) return { status: "duplicate" as const, draft };
  const result = applyStatusUpdate(draft.userId, draft, request);
  if (result.status !== "updated") return result;
  draft.providerWebhookEventIds = [...seen, eventId].slice(-100);
  persistStoreSnapshot();
  return { status: "updated" as const, draft };
}

function applyStatusUpdate(
  userId: string,
  draft: AgentCallRecord,
  request: UpdateAiCallingAgentCallStatusRequest,
) {
  if (!isWorkerStatus(request.status)) return { status: "invalid" as const };
  if (draft.status !== "queued" && draft.status !== "in_progress") {
    return { status: "invalid_state" as const, draft };
  }

  const now = new Date().toISOString();
  draft.status = request.status;
  if (request.status === "in_progress") draft.startedAt = draft.startedAt ?? now;
  if (request.status === "completed") draft.completedAt = now;
  if (request.status === "failed") draft.failedAt = now;
  const consumedSeconds = normalizedSeconds(request.consumedSeconds);
  if (consumedSeconds !== null) {
    draft.consumedSeconds = consumedSeconds;
  }
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
  return { status: "updated" as const, draft };
}

function settleUsageOnce(
  userId: string,
  draft: AgentCallRecord,
  options: {
    billableSeconds: number;
    releaseHold: boolean;
    settledAt: string;
  },
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
  if (options.releaseHold) {
    releaseUsageHold(userId, sessionId);
  } else {
    settleUsageHold(userId, sessionId, options.billableSeconds);
  }
  draft.usageSettledAt = options.settledAt;
}

function normalizedSeconds(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.ceil(value)
    : null;
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function defaultScript(objective: string) {
  return `您好，我想咨询：${objective}`;
}

function isScenario(value: string): value is CreateAiCallingAgentDraftRequest["scenario"] {
  return value === "booking" ||
    value === "customer_support" ||
    value === "business_inquiry" ||
    value === "custom";
}

function isPreAuthorizationCancellable(status: string) {
  return status === "draft" || status === "requires_human_takeover";
}

function isStartedStatus(status: string) {
  return status === "queued" ||
    status === "in_progress" ||
    status === "completed" ||
    status === "failed";
}

function isWorkerStatus(status: string): status is UpdateAiCallingAgentCallStatusRequest["status"] {
  return status === "in_progress" || status === "completed" || status === "failed";
}

function isTerminalWorkerStatus(status: UpdateAiCallingAgentCallStatusRequest["status"]) {
  return status === "completed" || status === "failed";
}
