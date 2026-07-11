import { requestJson } from "./script_service_utils.mjs";

export async function probeAgentCallInsufficientBalance(options) {
  const { config, checks, issues, actions, consentVersion } = options;
  const draft = (await requestJson(`${config.apiBaseUrl}/ai-calling-agent/drafts`, {
    ...options,
    method: "POST",
    body: {
      scenario: "booking",
      targetName: "余额验收门店",
      targetPhone: "+8613800138001",
      objective: "余额耗尽后不得再次进入 AI 电话拨号队列",
      suggestedScript: "您好，我想确认余额不足时不会继续拨号。",
      language: "zh",
    },
  })).body?.draft;
  if (!draft?.id) {
    fail(checks, issues, actions, "agent_call_insufficient_balance_blocks_queue", {
      reason: "draft_not_created",
    });
    return;
  }

  await requestJson(
    `${config.apiBaseUrl}/ai-calling-agent/drafts/${encodeURIComponent(draft.id)}/authorize`,
    { ...options, method: "POST", body: { userConfirmed: true, consentPromptVersion: consentVersion } },
  );
  const blocked = await requestJson(
    `${config.apiBaseUrl}/ai-calling-agent/drafts/${encodeURIComponent(draft.id)}/start`,
    { ...options, allowError: true, method: "POST", body: { consentPromptVersion: consentVersion } },
  );
  const responseDraft = blocked.body?.draft;
  const ok = blocked.status === 402 &&
    blocked.body?.error?.code === "agent_call_insufficient_balance" &&
    blocked.body?.usage?.remainingSeconds === 0 &&
    responseDraft?.status === "authorized" &&
    !responseDraft?.callId;
  record(checks, "agent_call_insufficient_balance_blocks_queue", ok, {
    httpStatus: blocked.status,
    errorCode: blocked.body?.error?.code,
    remainingSeconds: blocked.body?.usage?.remainingSeconds,
    draftStatus: responseDraft?.status,
    callId: responseDraft?.callId ?? null,
  });
  if (!ok) {
    issues.push("Agent call start did not block an insufficient-balance user before queueing.");
    actions.push("Inspect API usage balance and agent call start gate.");
  }
}

function fail(checks, issues, actions, name, details) {
  record(checks, name, false, details);
  issues.push("Agent call insufficient-balance probe could not create a draft.");
  actions.push("Inspect API draft creation and usage balance state.");
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}
