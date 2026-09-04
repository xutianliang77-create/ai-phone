import type {
  CreateAiCallingAgentDraftRequest,
  UpdateAiCallingAgentCallStatusRequest,
} from "@translation/contracts";

export function normalizedSeconds(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.ceil(value)
    : null;
}

export function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function fallbackAgentCallResultSummary(
  status: "cancelled" | "completed" | "failed",
  hasCall: boolean,
) {
  if (status === "cancelled") {
    return hasCall
      ? "通话已结束（用户取消），未生成业务结果摘要。"
      : "任务已取消，未发起电话。";
  }
  if (status === "completed") {
    return "通话已结束，但服务商未返回结构化业务结果。";
  }
  return "通话失败，服务商未返回结构化业务结果。";
}

export function isPlaceholderAgentCallSummary(value: unknown) {
  return value === "Voice Agent runtime ready; phone dial accepted";
}

export function defaultScript(objective: string) {
  return `您好，我想咨询：${objective}`;
}

export function isScenario(
  value: string,
): value is CreateAiCallingAgentDraftRequest["scenario"] {
  return (
    value === "booking" ||
    value === "customer_support" ||
    value === "business_inquiry" ||
    value === "custom"
  );
}

export function isAgentCallCancellable(status: string) {
  return (
    status === "draft" ||
    status === "authorized" ||
    status === "queued" ||
    status === "dispatching" ||
    status === "reconciliation_required" ||
    status === "in_progress" ||
    status === "requires_human_takeover" ||
    status === "takeover_requested"
  );
}

export function isStartedStatus(status: string) {
  return (
    status === "queued" ||
    status === "dispatching" ||
    status === "reconciliation_required" ||
    status === "in_progress" ||
    status === "completed" ||
    status === "failed"
  );
}

export function isWorkerStatus(
  status: string,
): status is UpdateAiCallingAgentCallStatusRequest["status"] {
  return (
    status === "in_progress" || status === "completed" || status === "failed"
  );
}

export function isTerminalWorkerStatus(
  status: UpdateAiCallingAgentCallStatusRequest["status"],
) {
  return status === "completed" || status === "failed";
}
