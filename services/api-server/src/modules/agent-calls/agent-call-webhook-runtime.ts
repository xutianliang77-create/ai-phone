import type {
  PstnAgentCallWebhookRequest,
  UpdateAiCallingAgentCallStatusRequest,
} from "@translation/contracts";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { findProviderOperation } from
  "../provider-operations/provider-operations-runtime.repository.js";
import type { AgentCallRecord } from "./agent-call-record.js";
import { cleanText } from "./agent-call-repository-helpers.js";
import {
  findAgentCallDraftByCallReference,
  findAgentCallDraftById,
  mutateAgentCallTask,
} from "./agent-calls-runtime.repository.js";
import {
  applyAgentCallStatusMutation,
  finalizeAgentCallStatus,
} from "./agent-call-lease-runtime.repository.js";
import * as legacy from "./agent-calls.repository.js";

type AgentCallWebhookResult =
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "duplicate" | "updated" | "invalid_state"; draft: AgentCallRecord };

export async function updateAgentCallFromPstnWebhook(
  request: PstnAgentCallWebhookRequest,
): Promise<AgentCallWebhookResult> {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.updateAgentCallFromPstnWebhook(request);
  const eventId = cleanText(request.eventId, 120);
  if (!eventId) return { status: "invalid" as const };
  const draft = await findAgentCallDraftByCallReference({
    callId: request.callId,
    providerCallId: request.providerCallId,
  });
  if (!draft) return { status: "not_found" as const };
  return applyTrustedWebhook(draft, eventId, request);
}

export async function failAgentCallRuntime(draftId: string, failureReason: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.failAgentCallRuntime(
    draftId, failureReason,
  );
  const draft = await findAgentCallDraftById(draftId);
  if (!draft) return null;
  const operation = draft.providerOperationId
    ? await findProviderOperation(draft.providerOperationId)
    : null;
  const reason = cleanText(failureReason, 300) || "voice_agent_runtime_failed";
  if (operation && ["accepted", "active", "unknown"].includes(operation.status)) {
    const result = await mutateAgentCallTask(
      draft,
      "runtime-reconciliation",
      { reason },
      (next) => {
        next.status = "reconciliation_required";
        next.failureReason = reason;
        next.nextStep = "已请求挂断；等待 LiveKit SIP 终态后按实际时长结算。";
        next.workerLeaseExpiresAt = undefined;
        next.updatedAt = new Date().toISOString();
        return next;
      },
      "agent.task.reconciliation_required",
      "updated",
    );
    return "task" in result ? result.task : draft;
  }
  const eventId = `runtime-failed:${draft.id}:${reason}`;
  const result = await applyTrustedWebhook(draft, eventId, {
    eventId,
    callId: draft.callId,
    providerCallId: draft.providerCallId,
    status: "failed",
    failureReason: reason,
    nextStep: "检查 Voice Agent runtime、模型与 LiveKit 事件后再重试。",
  });
  return "draft" in result ? result.draft : draft;
}

async function applyTrustedWebhook(
  draft: AgentCallRecord,
  eventId: string,
  request: PstnAgentCallWebhookRequest,
) {
  const seen = draft.providerWebhookEventIds ?? [];
  if (seen.includes(eventId)) return { status: "duplicate" as const, draft };
  const statusRequest: UpdateAiCallingAgentCallStatusRequest = {
    status: request.status,
    providerOperationStatus: request.status === "in_progress" ? "accepted"
      : request.status === "completed" ? "succeeded" : "failed",
    providerCallId: request.providerCallId,
    consumedSeconds: request.consumedSeconds,
    resultSummary: request.resultSummary,
    failureReason: request.failureReason,
    nextStep: request.nextStep,
  };
  const changed = await mutateAgentCallTask(
    draft,
    `pstn-webhook:${eventId}`,
    request,
    (next) => {
      const updated = applyAgentCallStatusMutation(next, statusRequest);
      if (!updated) return null;
      updated.providerWebhookEventIds = [...seen, eventId].slice(-100);
      updated.workerLeaseExpiresAt = undefined;
      return updated;
    },
    `agent.task.${request.status}`,
    "updated",
  );
  if (!("task" in changed) || !changed.task) {
    return { status: "invalid_state" as const, draft };
  }
  await finalizeAgentCallStatus(changed.task, statusRequest);
  return { status: "updated" as const, draft: changed.task };
}
