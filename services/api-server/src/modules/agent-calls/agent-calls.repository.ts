import { randomUUID } from "node:crypto";
import type {
  AuthorizeAiCallingAgentRequest,
  CancelAiCallingAgentDraftRequest,
  CreateAiCallingAgentDraftRequest,
  PstnAgentCallWebhookRequest,
  RequestAiCallingAgentTakeoverRequest,
} from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import {
  releaseUsageHold,
} from "../usage/usage.service.js";
import { classifyAgentCallRisk } from "./agent-call-risk.js";
import type { AgentCallRecord } from "./agent-call-record.js";
import {
  isValidAgentCallPhone,
  normalizeAgentCallPhone,
} from "./agent-call-gray-policy.js";
import {
  cleanText,
  fallbackAgentCallResultSummary,
  isPlaceholderAgentCallSummary,
  defaultScript,
  isAgentCallCancellable,
  isScenario,
} from "./agent-call-repository-helpers.js";
import {
  createAgentHandoff,
  findActiveAgentRun,
} from "./agent-orchestration.repository.js";
import { applyAgentCallStatusUpdate } from "./agent-call-status-update.js";
import {
  clearAgentCallLease,
  reconcileAgentCallProviderOperation,
} from "./agent-call-lease.repository.js";
import { findProviderOperation } from
  "../provider-operations/provider-operations.repository.js";
import { tryAcquireAgentCallMutation } from "./agent-call-mutation-lock.js";

export function createAgentCallDraft(
  userId: string,
  request: CreateAiCallingAgentDraftRequest,
) {
  const objective = cleanText(request.objective, 500);
  if (!objective || !isScenario(request.scenario)) return null;
  const targetPhone = cleanText(request.targetPhone, 32);
  if (targetPhone && !isValidAgentCallPhone(targetPhone)) return null;
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
    ...(targetPhone ? { targetPhone: normalizeAgentCallPhone(targetPhone) } : {}),
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
  if ((request.recordingRequested === true &&
      !cleanText(request.recordingPolicyVersion, 80)) ||
    (request.recordingRequested !== true &&
      request.recordingPolicyVersion !== undefined)) {
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
  draft.recipientDisclosureConfirmed = request.recipientDisclosureConfirmed === true;
  draft.disclosurePromptVersion = cleanText(request.disclosurePromptVersion, 80) ||
    undefined;
  draft.recordingRequested = request.recordingRequested === true;
  draft.recordingPolicyVersion = draft.recordingRequested
    ? cleanText(request.recordingPolicyVersion, 80) || undefined
    : undefined;
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
  if (!["requires_human_takeover", "in_progress", "takeover_requested"]
    .includes(draft.status)) return draft;
  if (draft.status === "takeover_requested") return draft;
  const now = new Date().toISOString();
  draft.status = "takeover_requested";
  draft.takeoverReadyAt = undefined;
  draft.takeoverResolvedAt = undefined;
  draft.takeoverParticipantIdentity = undefined;
  draft.takeoverReason = cleanText(request.reason, 200) || "user_requested";
  draft.takeoverRequestedAt = now;
  draft.updatedAt = now;
  const run = findActiveAgentRun(draft.id, "autonomous");
  if (run) {
    createAgentHandoff({
      runId: run.id,
      reason: draft.takeoverReason,
      redactedSummary: "User requested takeover",
      target: "user",
    });
  }
  persistStoreSnapshot();
  return draft;
}

export function cancelAgentCallDraft(
  userId: string,
  draftId: string,
  request: CancelAiCallingAgentDraftRequest,
) {
  const releaseMutation = tryAcquireAgentCallMutation(draftId);
  if (!releaseMutation) return { status: "mutation_conflict" as const };
  try {
    return runStoreTransaction(() => {
      const draft = findAgentCallDraft(userId, draftId);
      if (!draft) return { status: "not_found" as const };
      if (draft.status === "cancelled") {
        return { status: "replayed" as const, draft };
      }
      if (!isAgentCallCancellable(draft.status)) {
        return { status: "invalid_state" as const, draft };
      }
      const now = new Date().toISOString();
      const releaseHeldUsage = draft.status === "queued";
      draft.status = "cancelled";
      draft.cancellationReason = cleanText(request.reason, 200) || "user_cancelled";
      draft.cancelledAt = now;
      draft.updatedAt = now;
      if (!draft.resultSummary || isPlaceholderAgentCallSummary(draft.resultSummary)) {
        draft.resultSummary = fallbackAgentCallResultSummary("cancelled", Boolean(draft.callId));
      }
      if (draft.callId && !draft.nextStep) {
        draft.nextStep = "如需明确业务结果，请在通话记录中补充确认；不得因摘要缺失自动重拨。";
      }
      if (releaseHeldUsage && draft.callId) {
        releaseUsageHold(userId, draft.callId);
        draft.usageSettledAt = now;
      }
      persistStoreSnapshot();
      return { status: "cancelled" as const, draft };
    });
  } finally {
    releaseMutation();
  }
}

export function markAgentCallTakeoverReady(draftId: string) {
  return runStoreTransaction(() => {
    const draft = findAgentCallDraftById(draftId);
    if (!draft || draft.status !== "takeover_requested") return draft;
    draft.takeoverReadyAt ??= new Date().toISOString();
    draft.updatedAt = draft.takeoverReadyAt;
    persistStoreSnapshot();
    return draft;
  });
}

export function resumeAgentCallAfterTakeover(userId: string, draftId: string) {
  return runStoreTransaction(() => {
    const draft = findAgentCallDraft(userId, draftId);
    if (!draft || draft.status !== "takeover_requested") return null;
    draft.status = "in_progress";
    draft.agentControlState = "running";
    draft.agentResumedAt = new Date().toISOString();
    draft.takeoverResolvedAt ??= new Date().toISOString();
    draft.takeoverParticipantIdentity = undefined;
    draft.updatedAt = draft.takeoverResolvedAt;
    persistStoreSnapshot();
    return draft;
  });
}

export function resolveAgentCallTakeover(
  draftId: string,
  participantIdentity: string,
) {
  return runStoreTransaction(() => {
    const draft = findAgentCallDraftById(draftId);
    if (!draft || draft.status !== "takeover_requested") return null;
    draft.takeoverResolvedAt = new Date().toISOString();
    draft.takeoverParticipantIdentity = participantIdentity;
    draft.updatedAt = draft.takeoverResolvedAt;
    persistStoreSnapshot();
    return draft;
  });
}

export { startAgentCallDraft } from "./agent-call-start.js";

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
  const statusRequest = {
    ...request,
    providerOperationStatus: request.status === "in_progress" ? "accepted"
      : request.status === "completed" ? "succeeded" : "failed",
  } as const;
  const result = applyAgentCallStatusUpdate(draft.userId, draft, statusRequest);
  if (result.status !== "updated") return result;
  reconcileAgentCallProviderOperation(draft, statusRequest);
  clearAgentCallLease(draft);
  draft.providerWebhookEventIds = [...seen, eventId].slice(-100);
  persistStoreSnapshot();
  return { status: "updated" as const, draft };
}

export function failAgentCallRuntime(draftId: string, failureReason: string) {
  return runStoreTransaction(() => {
    const draft = findAgentCallDraftById(draftId);
    if (!draft) return null;
    const operation = draft.providerOperationId
      ? findProviderOperation(draft.providerOperationId)
      : null;
    if (operation && ["accepted", "active", "unknown"]
      .includes(operation.status)) {
      draft.status = "reconciliation_required";
      draft.failureReason = cleanText(failureReason, 300) ||
        "voice_agent_runtime_failed";
      draft.nextStep = "已请求挂断；等待 LiveKit SIP 终态后按实际时长结算。";
      draft.updatedAt = new Date().toISOString();
      clearAgentCallLease(draft);
      persistStoreSnapshot();
      return draft;
    }
    const result = applyAgentCallStatusUpdate(draft.userId, draft, {
      status: "failed",
      providerOperationStatus: "failed",
      failureReason: cleanText(failureReason, 300) || "voice_agent_runtime_failed",
      nextStep: "检查 Voice Agent runtime、模型与 LiveKit 事件后再重试。",
    });
    if (result.status === "updated") {
      reconcileAgentCallProviderOperation(draft, {
        status: "failed",
        providerOperationStatus: "failed",
        failureReason: draft.failureReason,
      });
      persistStoreSnapshot();
    }
    return draft;
  });
}
