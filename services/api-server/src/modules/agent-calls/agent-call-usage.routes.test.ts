import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { createUsageHold } from "../usage/usage.service.js";

describe("agent call usage readiness", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    configureAgentExecutionEnv();
    const store = getStoreSnapshot();
    store.agentCallDrafts = [];
    store.usageBalances = { "guest-user": 0 };
    store.usagePlanCodes = { "guest-user": "free" };
    store.usageHolds = [];
  });

  afterEach(() => restoreEnv(previousEnv));

  it("blocks starting a call when the user has no remaining seconds", async () => {
    const app = await buildApp();
    const draftId = await createAuthorizedDraft(app);
    const started = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/start`,
      payload: { consentPromptVersion: "cn-agent-v1" },
    });
    const detail = await app.inject({
      method: "GET",
      url: `/ai-calling-agent/drafts/${draftId}`,
    });
    await app.close();

    expect(started.statusCode).toBe(402);
    expect(started.json()).toMatchObject({
      error: { code: "agent_call_insufficient_balance" },
      usage: {
        status: "not_ready",
        minimumStartSeconds: 60,
        remainingSeconds: 0,
      },
    });
    expect(detail.json().draft).toMatchObject({ status: "authorized" });
    expect(detail.json().draft.callId).toBeUndefined();
  });

  it("blocks starting a call when active holds consume availability", async () => {
    const store = getStoreSnapshot();
    store.usageBalances = { "guest-user": 60 };
    createUsageHold("guest-user", 60, undefined, {
      sessionId: "other-session",
      idempotencyKey: "hold:other-session",
    });
    const app = await buildApp();
    const draftId = await createAuthorizedDraft(app);
    const started = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/start`,
      payload: { consentPromptVersion: "cn-agent-v1" },
    });
    await app.close();

    expect(started.statusCode).toBe(402);
    expect(started.json()).toMatchObject({
      error: { code: "agent_call_insufficient_balance" },
      usage: {
        status: "not_ready",
        remainingSeconds: 60,
        heldSeconds: 60,
        availableSeconds: 0,
      },
    });
  });
});

async function createAuthorizedDraft(app: Awaited<ReturnType<typeof buildApp>>) {
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
    payload: { userConfirmed: true, consentPromptVersion: "cn-agent-v1" },
  });
  return draftId;
}

const envKeys = [
  "AGENT_CALL_WORKER_ENABLED",
  "AGENT_CALL_PROVIDER_ADAPTER",
  "AGENT_CALL_WORKER_LEASE_SECONDS",
  "AGENT_CALL_RECONCILIATION_TIMEOUT_SECONDS",
  "PSTN_PROVIDER_IDEMPOTENCY_GUARANTEED",
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
];

function configureAgentExecutionEnv() {
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

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
