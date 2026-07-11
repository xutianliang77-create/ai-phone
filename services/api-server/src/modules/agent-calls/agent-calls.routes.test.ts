import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

describe("agent call routes", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    clearEnv();
    const store = getStoreSnapshot();
    store.agentCallDrafts = [];
    store.usageBalances = {};
    store.usagePlanCodes = {};
    store.usageHolds = [];
    store.billingLedger = [];
  });

  afterEach(() => {
    restoreEnv(previousEnv);
  });

  it("creates a low risk draft and authorizes it only after user confirmation", async () => {
    const app = await buildApp();
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
    const rejected = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/authorize`,
      payload: { userConfirmed: false, consentPromptVersion: "cn-agent-v1" },
    });
    const authorized = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/authorize`,
      payload: { userConfirmed: true, consentPromptVersion: "cn-agent-v1" },
    });
    await app.close();

    expect(created.statusCode).toBe(201);
    expect(created.json().draft).toMatchObject({
      status: "draft",
      riskLevel: "low",
      targetPhone: "13800138000",
    });
    expect(rejected.statusCode).toBe(400);
    expect(authorized.json().draft).toMatchObject({
      status: "authorized",
      consentPromptVersion: "cn-agent-v1",
    });
  });

  it("cancels drafts before authorization and blocks later authorization", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/ai-calling-agent/drafts",
      payload: { scenario: "booking", objective: "预约牙医复诊" },
    });
    const draftId = created.json().draft.id as string;
    const cancelled = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/cancel`,
      payload: { reason: "用户确认前取消" },
    });
    const authorized = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/authorize`,
      payload: { userConfirmed: true, consentPromptVersion: "cn-agent-v1" },
    });
    await app.close();

    expect(cancelled.json().draft).toMatchObject({
      status: "cancelled",
      cancellationReason: "用户确认前取消",
    });
    expect(cancelled.json().draft.cancelledAt).toEqual(expect.any(String));
    expect(authorized.statusCode).toBe(409);
    expect(authorized.json().error.code).toBe("agent_call_cancelled");
  });

  it("requires human takeover for high risk agent call drafts", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/ai-calling-agent/drafts",
      payload: {
        scenario: "customer_support",
        objective: "联系银行客服处理转账和身份验证问题",
      },
    });
    const draftId = created.json().draft.id as string;
    const authorized = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/authorize`,
      payload: { userConfirmed: true, consentPromptVersion: "cn-agent-v1" },
    });
    const takeover = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/takeover`,
      payload: { reason: "涉及付款和身份验证，用户人工接管" },
    });
    await app.close();

    expect(created.json().draft).toMatchObject({
      status: "requires_human_takeover",
      riskLevel: "requires_human_takeover",
    });
    expect(created.json().draft.riskReasons).toEqual(
      expect.arrayContaining(["payment", "identity_verification"]),
    );
    expect(authorized.statusCode).toBe(409);
    expect(takeover.json().draft).toMatchObject({
      status: "takeover_requested",
      takeoverReason: "涉及付款和身份验证，用户人工接管",
    });
  });

  it("does not cancel authorized drafts with the pre-authorization endpoint", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/ai-calling-agent/drafts",
      payload: { scenario: "custom", objective: "咨询营业时间" },
    });
    const draftId = created.json().draft.id as string;
    await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/authorize`,
      payload: { userConfirmed: true, consentPromptVersion: "cn-agent-v1" },
    });
    const cancelled = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/cancel`,
      payload: { reason: "too_late" },
    });
    await app.close();

    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json().error.code).toBe("agent_call_cannot_cancel");
    expect(cancelled.json().draft.status).toBe("authorized");
  });

  it("does not start authorized drafts when execution is not configured", async () => {
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

    expect(started.statusCode).toBe(503);
    expect(started.json().error.code).toBe("agent_call_execution_not_ready");
    expect(started.json().readiness.issues).toEqual(
      expect.arrayContaining(["agent call worker disabled"]),
    );
    expect(detail.json().draft.status).toBe("authorized");
    expect(detail.json().draft.callId).toBeUndefined();
  });

  it("queues authorized drafts and accepts worker execution updates", async () => {
    configureAgentExecutionEnv();
    const app = await buildApp();
    const draftId = await createAuthorizedDraft(app);
    const queued = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/start`,
      payload: { consentPromptVersion: "cn-agent-v1" },
    });
    const inProgress = await app.inject({
      method: "POST",
      url: `/internal/ai-calling-agent/drafts/${draftId}/status`,
      headers: { authorization: "Bearer internal-secret-for-agent" },
      payload: {
        status: "in_progress",
        providerCallId: "provider-call-1",
      },
    });
    const completed = await app.inject({
      method: "POST",
      url: `/internal/ai-calling-agent/drafts/${draftId}/status`,
      headers: { authorization: "Bearer internal-secret-for-agent" },
      payload: {
        status: "completed",
        consumedSeconds: 17,
        resultSummary: "已完成预约并确认时间。",
        nextStep: "等待短信确认。",
      },
    });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    await app.close();

    expect(queued.json().draft).toMatchObject({
      status: "queued",
      executionProvider: "domestic_bridge",
    });
    expect(queued.json().draft.callId).toEqual(expect.any(String));
    expect(queued.json().draft.queuedAt).toEqual(expect.any(String));
    expect(inProgress.json().draft).toMatchObject({
      status: "in_progress",
      providerCallId: "provider-call-1",
    });
    expect(inProgress.json().draft.startedAt).toEqual(expect.any(String));
    expect(completed.json().draft).toMatchObject({
      status: "completed",
      consumedSeconds: 17,
      usageSettledAt: expect.any(String),
      resultSummary: "已完成预约并确认时间。",
      nextStep: "等待短信确认。",
    });
    expect(completed.json().draft.completedAt).toEqual(expect.any(String));
    expect(balance.json().remainingSeconds).toBe(283);
    expect(balance.json().heldSeconds).toBe(0);
    expect(balance.json().availableSeconds).toBe(283);
    expect(ledger.json().ledger).toContainEqual(expect.objectContaining({
      type: "usage",
      deltaSeconds: -17,
      balanceAfter: 283,
      sessionId: queued.json().draft.callId,
      note: "agent_call_usage",
      idempotencyKey: `settle:${queued.json().draft.callId}`,
    }));
  });

  it("protects worker execution updates with the internal secret", async () => {
    configureAgentExecutionEnv();
    const app = await buildApp();
    const draftId = await createAuthorizedDraft(app);
    await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/start`,
      payload: { consentPromptVersion: "cn-agent-v1" },
    });
    const rejected = await app.inject({
      method: "POST",
      url: `/internal/ai-calling-agent/drafts/${draftId}/status`,
      payload: { status: "in_progress" },
    });
    await app.close();

    expect(rejected.statusCode).toBe(401);
    expect(rejected.json().error.code).toBe("internal_error");
  });

  it("lists and returns drafts without exposing user ids", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/ai-calling-agent/drafts",
      payload: { scenario: "custom", objective: "咨询营业时间" },
    });
    const draftId = created.json().draft.id as string;
    const list = await app.inject({ method: "GET", url: "/ai-calling-agent/drafts" });
    const detail = await app.inject({
      method: "GET",
      url: `/ai-calling-agent/drafts/${draftId}`,
    });
    await app.close();

    expect(list.json().drafts).toHaveLength(1);
    expect(detail.json().draft.id).toBe(draftId);
    expect(detail.json().draft.userId).toBeUndefined();
  });
});

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

function clearEnv() {
  for (const key of envKeys) delete process.env[key];
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
