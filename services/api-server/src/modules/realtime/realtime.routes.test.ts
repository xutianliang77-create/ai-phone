import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

const internalSecret = "internal-secret-123";
const internalHeaders = { authorization: `Bearer ${internalSecret}` };

describe("realtime internal routes", () => {
  let previousSecret: string | undefined;

  beforeEach(() => {
    previousSecret = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = internalSecret;
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usageBalances = {};
    store.usagePlanCodes = {};
    store.usageHolds = [];
    store.billingLedger = [];
  });

  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env.INTERNAL_API_SECRET;
    } else {
      process.env.INTERNAL_API_SECRET = previousSecret;
    }
  });

  it("upserts realtime segments internally and ends sessions idempotently", async () => {
    const app = await buildApp();
    const sessionId = await createRealtimeSession(app);
    const source = await app.inject({
      method: "POST",
      url: "/internal/realtime/segments",
      headers: internalHeaders,
      payload: {
        sessionId,
        segmentId: "seg_live",
        sourceText: "good morning",
        sourceLanguage: "en",
        confidence: 0.93,
        stage: "asr",
      },
    });
    const translation = await app.inject({
      method: "POST",
      url: "/internal/realtime/segments",
      headers: internalHeaders,
      payload: {
        sessionId,
        segmentId: "seg_live",
        translatedText: "早上好",
        targetLanguage: "zh",
        stage: "translation",
        providerUsage: {
          provider: "qwen_live",
          model: "qwen-plus",
          latencyMs: 420,
          estimatedTotalTokens: 6,
        },
      },
    });
    const firstEnd = await app.inject({
      method: "POST",
      url: `/internal/realtime/sessions/${sessionId}/end`,
      headers: internalHeaders,
    });
    const firstBalance = await app.inject({
      method: "GET",
      url: "/usage/balance",
    });
    const secondEnd = await app.inject({
      method: "POST",
      url: `/realtime/sessions/${sessionId}/end`,
    });
    const secondBalance = await app.inject({
      method: "GET",
      url: "/usage/balance",
    });
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    const detail = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    const markdown = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/export?format=markdown`,
    });
    const csv = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/export?format=csv`,
    });
    await app.close();

    expect(source.statusCode).toBe(200);
    expect(translation.statusCode).toBe(200);
    expect(firstEnd.statusCode).toBe(200);
    expect(secondEnd.statusCode).toBe(200);
    expect(firstBalance.json().remainingSeconds).toBe(
      secondBalance.json().remainingSeconds,
    );
    expect(detail.json().consumedSeconds).toBe(0);
    expect(ledger.json().ledger).toHaveLength(0);
    expect(detail.json().segments[0]).toMatchObject({
      id: "seg_live",
      sourceText: "good morning",
      translatedText: "早上好",
      sourceLanguage: "en",
      targetLanguage: "zh",
      confidence: 0.93,
      stage: "translation",
      provider: "qwen_live",
      model: "qwen-plus",
      latencyMs: 420,
      providerUsage: {
        provider: "qwen_live",
        model: "qwen-plus",
        estimatedTotalTokens: 6,
      },
    });
    expect(markdown.json().content).toContain("## Provider Usage");
    expect(markdown.json().content).toContain("Estimated tokens: 6");
    expect(markdown.json().content).toContain("Source language: en");
    expect(markdown.json().content).toContain("Target language: zh");
    expect(csv.json().content).toContain(
      '"sourceLanguage","targetLanguage","confidence","stage"',
    );
    expect(csv.json().content).toContain(
      '"en","zh","0.93","translation","qwen_live","qwen-plus","420","6"',
    );
  });

  it("settles billable realtime usage once with session ledger metadata", async () => {
    const app = await buildApp();
    const sessionId = await createRealtimeSession(app);
    ageSession(sessionId, 8_000);

    const before = await app.inject({ method: "GET", url: "/usage/balance" });
    const firstEnd = await app.inject({
      method: "POST",
      url: `/internal/realtime/sessions/${sessionId}/end`,
      headers: internalHeaders,
    });
    const repeatedEnd = await app.inject({
      method: "POST",
      url: `/realtime/sessions/${sessionId}/end`,
    });
    const after = await app.inject({ method: "GET", url: "/usage/balance" });
    const detail = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    await app.close();

    const consumedSeconds = detail.json().consumedSeconds as number;
    expect(firstEnd.statusCode).toBe(200);
    expect(repeatedEnd.statusCode).toBe(200);
    expect(consumedSeconds).toBeGreaterThanOrEqual(6);
    expect(after.json().remainingSeconds).toBe(
      before.json().remainingSeconds - consumedSeconds,
    );
    expect(ledger.json().ledger).toHaveLength(1);
    expect(ledger.json().ledger[0]).toMatchObject({
      type: "usage",
      source: "system",
      deltaSeconds: -consumedSeconds,
      sessionId,
      idempotencyKey: `settle:${sessionId}`,
      note: "realtime_session_usage",
    });
  });

  it("uses internal billable seconds when gateway ends on quota", async () => {
    const app = await buildApp();
    const sessionId = await createRealtimeSession(app);
    ageSession(sessionId, 120_000);

    const before = await app.inject({ method: "GET", url: "/usage/balance" });
    const ended = await app.inject({
      method: "POST",
      url: `/internal/realtime/sessions/${sessionId}/end`,
      headers: internalHeaders,
      payload: { billableSeconds: 45 },
    });
    const after = await app.inject({ method: "GET", url: "/usage/balance" });
    const detail = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    await app.close();

    expect(ended.statusCode).toBe(200);
    expect(detail.json().consumedSeconds).toBe(45);
    expect(after.json().remainingSeconds).toBe(
      before.json().remainingSeconds - 45,
    );
    expect(ledger.json().ledger[0]).toMatchObject({
      type: "usage",
      deltaSeconds: -45,
      sessionId,
      idempotencyKey: `settle:${sessionId}`,
      note: "realtime_session_usage",
    });
  });

  it("refunds settled session usage idempotently through the internal route", async () => {
    const app = await buildApp();
    const sessionId = await createRealtimeSession(app);
    ageSession(sessionId, 30_000);

    const before = await app.inject({ method: "GET", url: "/usage/balance" });
    await app.inject({
      method: "POST",
      url: `/internal/realtime/sessions/${sessionId}/end`,
      headers: internalHeaders,
      payload: { billableSeconds: 20 },
    });
    const refunded = await app.inject({
      method: "POST",
      url: `/internal/sessions/${sessionId}/refund`,
      headers: internalHeaders,
      payload: { reason: "service_error" },
    });
    const repeated = await app.inject({
      method: "POST",
      url: `/internal/sessions/${sessionId}/refund`,
      headers: internalHeaders,
      payload: { reason: "service_error" },
    });
    const after = await app.inject({ method: "GET", url: "/usage/balance" });
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    await app.close();

    expect(refunded.statusCode).toBe(200);
    expect(repeated.statusCode).toBe(200);
    expect(refunded.json()).toMatchObject({
      sessionId,
      refundedSeconds: 20,
      reason: "service_error",
      idempotencyKey: `refund:${sessionId}`,
    });
    expect(after.json().remainingSeconds).toBe(before.json().remainingSeconds);
    const refundEntries = ledger.json().ledger.filter((entry: { type: string }) =>
      entry.type === "refund"
    );
    expect(refundEntries).toHaveLength(1);
    expect(refundEntries[0]).toMatchObject({
      type: "refund",
      source: "system",
      deltaSeconds: 20,
      balanceAfter: before.json().remainingSeconds,
      sessionId,
      idempotencyKey: `refund:${sessionId}`,
      note: "usage_refund:service_error",
    });
  });

  it("holds realtime start seconds and blocks concurrent sessions without availability", async () => {
    const store = getStoreSnapshot();
    store.usagePlanCodes["guest-user"] = "free";
    store.usageBalances["guest-user"] = 30;
    const app = await buildApp();
    const first = await app.inject({
      method: "POST",
      url: "/realtime/sessions",
      payload: {
        mode: "conversation",
        sourceLanguage: "en",
        targetLanguage: "zh",
        voiceOutput: false,
      },
    });
    const second = await app.inject({
      method: "POST",
      url: "/realtime/sessions",
      payload: {
        mode: "conversation",
        sourceLanguage: "en",
        targetLanguage: "zh",
        voiceOutput: false,
      },
    });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    await app.close();

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(402);
    expect(second.json().error.code).toBe("quota_not_enough");
    expect(balance.json()).toMatchObject({
      remainingSeconds: 30,
      heldSeconds: 30,
      availableSeconds: 0,
    });
  });

  it("rejects internal segment writes when the internal secret is missing", async () => {
    delete process.env.INTERNAL_API_SECRET;
    const app = await buildApp();
    const rejected = await app.inject({
      method: "POST",
      url: "/internal/realtime/segments",
      payload: { sessionId: "missing", segmentId: "seg", sourceText: "hello" },
    });
    await app.close();

    expect(rejected.statusCode).toBe(401);
    expect(rejected.json().error.code).toBe("internal_error");
  });

  it("accepts Hy-MT languages and auto reverse realtime sessions", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/realtime/sessions",
      payload: {
        mode: "conversation",
        sourceLanguage: "auto",
        targetLanguage: "ja",
        autoReverseTargetLanguage: true,
        voiceOutput: true,
      },
    });
    await app.close();

    expect(created.statusCode).toBe(200);
    expect(created.json().realtimeToken).toBeTruthy();
  });

});

async function createRealtimeSession(
  app: Awaited<ReturnType<typeof buildApp>>,
) {
  const created = await app.inject({
    method: "POST",
    url: "/realtime/sessions",
    payload: {
      mode: "conversation",
      sourceLanguage: "en",
      targetLanguage: "zh",
      voiceOutput: false,
    },
  });
  return created.json().sessionId as string;
}

function ageSession(sessionId: string, ageMs: number) {
  const session = getStoreSnapshot().sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error(`Missing test session ${sessionId}`);
  session.createdAt = new Date(Date.now() - ageMs).toISOString();
}
