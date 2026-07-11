import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { signPstnAgentCallWebhookBody } from "./agent-call-pstn-webhook.js";

describe("agent call PSTN webhook route", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    const store = getStoreSnapshot();
    store.agentCallDrafts = [];
    store.usageBalances = {};
    store.usagePlanCodes = {};
    store.usageHolds = [];
    store.billingLedger = [];
    configureAgentExecutionEnv();
  });

  afterEach(() => restoreEnv(previousEnv));

  it("accepts signed completion updates and deduplicates event ids", async () => {
    const app = await buildApp();
    const { callId } = await createInProgressDraft(app);
    const body = {
      eventId: "pstn-event-1",
      callId,
      providerCallId: "provider-call-1",
      status: "completed" as const,
      consumedSeconds: 25,
      resultSummary: "对方已确认预约。",
      nextStep: "按时到店。",
    };
    const headers = signedHeaders(body);
    const completed = await app.inject({
      method: "POST",
      url: "/webhooks/pstn/agent-calls",
      headers,
      payload: body,
    });
    const replay = await app.inject({
      method: "POST",
      url: "/webhooks/pstn/agent-calls",
      headers,
      payload: body,
    });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    await app.close();

    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      status: "updated",
      draft: {
        status: "completed",
        providerCallId: "provider-call-1",
        consumedSeconds: 25,
        usageSettledAt: expect.any(String),
        resultSummary: "对方已确认预约。",
        nextStep: "按时到店。",
      },
    });
    expect(completed.json().draft.providerWebhookEventIds).toBeUndefined();
    expect(replay.json()).toMatchObject({
      status: "duplicate",
      draft: { status: "completed" },
    });
    expect(balance.json().remainingSeconds).toBe(275);
    expect(ledger.json().ledger.filter((entry: { note?: string }) =>
      entry.note === "agent_call_usage"
    )).toHaveLength(1);
  });

  it("rejects webhook updates with invalid signatures", async () => {
    const app = await buildApp();
    await createQueuedDraft(app);
    const rejected = await app.inject({
      method: "POST",
      url: "/webhooks/pstn/agent-calls",
      headers: { "x-translation-pstn-signature": "bad" },
      payload: {
        eventId: "pstn-event-2",
        callId: "call-unknown",
        status: "failed",
        failureReason: "busy",
      },
    });
    await app.close();

    expect(rejected.statusCode).toBe(401);
    expect(rejected.json().error.code).toBe("invalid_pstn_webhook_signature");
  });

  it("updates failed status by call id when provider call id is absent", async () => {
    const app = await buildApp();
    const { callId } = await createQueuedDraft(app);
    const body = {
      eventId: "pstn-event-3",
      callId,
      status: "failed" as const,
      consumedSeconds: 25,
      failureReason: "对方忙线",
      nextStep: "稍后重试。",
    };
    const failed = await app.inject({
      method: "POST",
      url: "/webhooks/pstn/agent-calls",
      headers: signedHeaders(body),
      payload: body,
    });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    await app.close();

    expect(failed.statusCode).toBe(200);
    expect(failed.json().draft).toMatchObject({
      status: "failed",
      consumedSeconds: 25,
      usageSettledAt: expect.any(String),
      failureReason: "对方忙线",
      nextStep: "稍后重试。",
    });
    expect(failed.json().draft.failedAt).toEqual(expect.any(String));
    expect(balance.json()).toMatchObject({
      remainingSeconds: 300,
      heldSeconds: 0,
      availableSeconds: 300,
    });
    expect(ledger.json().ledger).toHaveLength(0);
  });
});

async function createQueuedDraft(app: Awaited<ReturnType<typeof buildApp>>) {
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
  const queued = await app.inject({
    method: "POST",
    url: `/ai-calling-agent/drafts/${draftId}/start`,
    payload: { consentPromptVersion: "cn-agent-v1" },
  });
  return { draftId, callId: queued.json().draft.callId as string };
}

async function createInProgressDraft(app: Awaited<ReturnType<typeof buildApp>>) {
  const queued = await createQueuedDraft(app);
  await app.inject({
    method: "POST",
    url: `/internal/ai-calling-agent/drafts/${queued.draftId}/status`,
    headers: { authorization: "Bearer internal-secret-for-agent" },
    payload: { status: "in_progress", providerCallId: "provider-call-1" },
  });
  return queued;
}

function signedHeaders(body: Parameters<typeof signPstnAgentCallWebhookBody>[1]) {
  return {
    "x-translation-pstn-signature": signPstnAgentCallWebhookBody(
      process.env.PSTN_WEBHOOK_SECRET!,
      body,
    ),
  };
}

const envKeys = [
  "AGENT_CALL_WORKER_ENABLED",
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
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
