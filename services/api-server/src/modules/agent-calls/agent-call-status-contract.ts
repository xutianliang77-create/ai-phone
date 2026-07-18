import type { UpdateAiCallingAgentCallStatusRequest } from "@translation/contracts";
import type { AgentCallRecord } from "./agent-call-record.js";
import { isWorkerStatus } from "./agent-call-repository-helpers.js";

export function isValidAgentCallStatusUpdate(
  request: UpdateAiCallingAgentCallStatusRequest,
) {
  if (!isWorkerStatus(request.status) ||
    !validProviderOperationStatus(request.providerOperationStatus)) return false;
  const providerStatus = request.providerOperationStatus;
  if (providerStatus === undefined || providerStatus === "unknown") return true;
  return (request.status === "in_progress" && providerStatus === "accepted") ||
    (request.status === "completed" && providerStatus === "succeeded") ||
    (request.status === "failed" && providerStatus === "failed");
}

export function terminalReplayRequest(
  draft: AgentCallRecord,
  request: UpdateAiCallingAgentCallStatusRequest,
): UpdateAiCallingAgentCallStatusRequest | null {
  if (draft.status === "completed" && request.status === "completed" &&
    (request.providerOperationStatus === undefined ||
      request.providerOperationStatus === "succeeded")) {
    return {
      status: "completed",
      providerOperationStatus: "succeeded",
      providerCallId: draft.providerCallId,
      consumedSeconds: draft.consumedSeconds,
      resultSummary: draft.resultSummary,
    };
  }
  if (draft.status === "failed" && request.status === "failed" &&
    (request.providerOperationStatus === undefined ||
      request.providerOperationStatus === "failed")) {
    return {
      status: "failed",
      providerOperationStatus: "failed",
      providerCallId: draft.providerCallId,
      failureReason: draft.failureReason,
      nextStep: draft.nextStep,
    };
  }
  if (draft.status === "reconciliation_required" &&
    request.providerOperationStatus === "unknown") {
    return {
      status: "failed",
      providerOperationStatus: "unknown",
      providerCallId: draft.providerCallId,
      failureReason: draft.failureReason,
      nextStep: draft.nextStep,
    };
  }
  return null;
}

function validProviderOperationStatus(value: unknown) {
  return value === undefined || value === "accepted" || value === "unknown" ||
    value === "succeeded" || value === "failed";
}
