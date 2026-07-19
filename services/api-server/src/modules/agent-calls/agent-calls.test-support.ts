import { buildApp } from "../../app.js";

const envKeys = [
  "AGENT_CALL_WORKER_ENABLED",
  "AGENT_CALL_PROVIDER_ADAPTER",
  "AGENT_CALL_WORKER_LEASE_SECONDS",
  "AGENT_CALL_RECONCILIATION_TIMEOUT_SECONDS",
  "PSTN_PROVIDER_IDEMPOTENCY_GUARANTEED",
  "AGENT_CALL_GRAY_ENABLED",
  "AGENT_CALL_GRAY_USER_IDS",
  "AGENT_CALL_RATE_LIMIT_PER_HOUR",
  "AGENT_CALL_DO_NOT_CALL_NUMBERS",
  "CALL_PROVIDER_POLICY",
  "INTERNAL_API_SECRET",
  "PSTN_PROVIDER",
  "PSTN_ACCOUNT_ID",
  "PSTN_API_KEY",
  "PSTN_WEBHOOK_BASE_URL",
  "PSTN_WEBHOOK_SECRET",
  "PSTN_CONSENT_PROMPT_VERSION",
  "PSTN_RECORDING_DISCLOSURE_ENABLED",
  "PSTN_MAX_CALL_MINUTES",
  "VOICE_AGENT_RECORDING_ENABLED",
  "VOICE_AGENT_RECORDING_POLICY_VERSION",
  "VOICE_AGENT_RECORDING_CONSENT_TEXT_ZH",
  "VOICE_AGENT_RECORDING_CONSENT_TEXT_EN",
  "VOICE_AGENT_RECORDING_CONSENT_TTL_SECONDS",
];

export async function createAuthorizedDraft(
  app: Awaited<ReturnType<typeof buildApp>>,
  disclosure = false,
) {
  const created = await app.inject({
    method: "POST",
    url: "/ai-calling-agent/drafts",
    payload: {
      scenario: "booking",
      objective: "预约明天下午三点的会议室",
      targetPhone: "13800138000",
    },
  });
  const draftId = created.json().draft.id as string;
  await app.inject({
    method: "POST",
    url: `/ai-calling-agent/drafts/${draftId}/authorize`,
    payload: {
      userConfirmed: true,
      consentPromptVersion: "cn-agent-v1",
      recipientDisclosureConfirmed: disclosure,
      disclosurePromptVersion: disclosure ? "cn-agent-disclosure-v1" : undefined,
    },
  });
  return draftId;
}

export function configureAgentExecutionEnv() {
  process.env.AGENT_CALL_WORKER_ENABLED = "true";
  process.env.AGENT_CALL_PROVIDER_ADAPTER = "pstn_http";
  process.env.AGENT_CALL_WORKER_LEASE_SECONDS = "45";
  process.env.AGENT_CALL_RECONCILIATION_TIMEOUT_SECONDS = "7200";
  process.env.PSTN_PROVIDER_IDEMPOTENCY_GUARANTEED = "true";
  process.env.CALL_PROVIDER_POLICY = "domestic_pstn_bridge";
  process.env.INTERNAL_API_SECRET = "internal-secret-for-agent";
  process.env.PSTN_PROVIDER = "domestic_bridge";
  process.env.PSTN_ACCOUNT_ID = "pstn-account";
  process.env.PSTN_API_KEY = "pstn-api-key";
  process.env.PSTN_WEBHOOK_BASE_URL = "https://calls.qkxy.cn";
  process.env.PSTN_WEBHOOK_SECRET = "12345678901234567890123456789012";
  process.env.PSTN_CONSENT_PROMPT_VERSION = "cn-agent-v1";
  process.env.PSTN_RECORDING_DISCLOSURE_ENABLED = "true";
  process.env.PSTN_MAX_CALL_MINUTES = "30";
}

export function captureAgentCallEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

export function clearAgentCallEnv() {
  for (const key of envKeys) delete process.env[key];
}

export function restoreAgentCallEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
