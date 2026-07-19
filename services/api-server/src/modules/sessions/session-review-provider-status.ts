import { loadLlmConfig } from "@translation/llm";

interface RemoteReviewRuntimeStatus {
  configKey: string;
  status: "ready" | "degraded";
  issues: string[];
  checkedAt: string;
}

let remoteReviewRuntimeStatus: RemoteReviewRuntimeStatus | undefined;

export function sessionReviewProviderStatus() {
  const config = loadLlmConfig();
  if (!config.reviewEnabled || config.provider === "off") {
    return { provider: "local", status: "ready", issues: [] };
  }
  const issues = reviewConfigIssues(config);
  const runtimeStatus =
    remoteReviewRuntimeStatus?.configKey === reviewConfigKey(config)
      ? remoteReviewRuntimeStatus
      : undefined;
  return {
    provider:
      config.provider === "openai_compatible" ? "openai_compatible" : "local",
    status:
      issues.length > 0
        ? "configuration_required"
        : (runtimeStatus?.status ?? "ready"),
    issues: issues.length > 0 ? issues : (runtimeStatus?.issues ?? []),
    ...(runtimeStatus ? { lastCheckedAt: runtimeStatus.checkedAt } : {}),
  };
}

export function recordRemoteReviewFailure(
  config: ReturnType<typeof loadLlmConfig>,
  reason: string,
  now = new Date(),
) {
  remoteReviewRuntimeStatus = {
    configKey: reviewConfigKey(config),
    status: "degraded",
    issues: [sanitizeReason(reason)],
    checkedAt: now.toISOString(),
  };
}

export function recordRemoteReviewSuccess(
  config: ReturnType<typeof loadLlmConfig>,
  now = new Date(),
) {
  remoteReviewRuntimeStatus = {
    configKey: reviewConfigKey(config),
    status: "ready",
    issues: [],
    checkedAt: now.toISOString(),
  };
}

export function resetSessionReviewProviderRuntimeStatusForTest() {
  remoteReviewRuntimeStatus = undefined;
}

function reviewConfigKey(config: ReturnType<typeof loadLlmConfig>) {
  return [
    config.provider,
    config.baseUrl ?? "",
    config.reviewModel ?? "",
    config.reviewEnabled ? "enabled" : "disabled",
  ].join("|");
}

function reviewConfigIssues(config: ReturnType<typeof loadLlmConfig>) {
  const issues: string[] = [];
  if (config.provider === "openai_compatible") {
    if (!config.baseUrl) issues.push("llm missing LLM_BASE_URL");
    if (!config.reviewModel) issues.push("llm missing LLM_REVIEW_MODEL");
  }
  return issues;
}

function sanitizeReason(reason: string) {
  return reason.replace(/\s+/g, " ").slice(0, 180);
}
