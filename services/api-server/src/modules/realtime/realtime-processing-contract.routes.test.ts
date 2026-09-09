import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

const payload = () => ({ mode: "conversation", sourceLanguage: "zh", targetLanguage: "en", voiceOutput: false });
const processing = () => ({
  contractVersion: 1, processingMode: "online", modelPolicyRevision: "test-policy-r6",
  languagePolicy: { source: "zh", target: "en", autoReverse: false, pair: ["zh", "en"], revision: 1 },
  executionPlan: { asr: { execution: "public", scopeKey: "public/asr/zh", reason: "online_selected" },
    translation: { execution: "public", scopeKey: "public/mt/zh-en", reason: "online_selected" }, tts: { execution: "disabled" } },
  syncRequested: true,
});

function effects() {
  const store = getStoreSnapshot();
  return structuredClone({ sessions: store.sessions, holds: store.usageHolds, ledger: store.billingLedger });
}

describe("S1 processing admission uses no legacy inference or settlement", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.sessions = []; store.usageBalances = {}; store.usagePlanCodes = {};
    store.usageHolds = []; store.billingLedger = [];
  });

  it("rejects an unwired online contract before creating a session or hold", async () => {
    const app = await buildApp();
    try {
      const before = effects();
      const reply = await app.inject({ method: "POST", url: "/realtime/sessions", payload: { ...payload(), processing: processing() } });
      expect(reply.statusCode).toBe(503);
      expect(reply.json().error.code).toBe("processing_contract_not_ready");
      expect(effects()).toEqual(before);
    } finally { await app.close(); }
  });

  it("never creates a server session for local processing or a malformed negotiation", async () => {
    const app = await buildApp();
    try {
      const before = effects();
      for (const extra of [
        { processing: { ...processing(), processingMode: "local", syncRequested: false,
          executionPlan: { asr: { execution: "device", scopeKey: "local/asr/zh" },
            translation: { execution: "device", scopeKey: "local/mt/zh-en" }, tts: { execution: "disabled" } } } },
        { processing: { ...processing(), publicAccess: { authenticated: true } } },
        { processingMode: "local" }, { processing: { ...processing(), contractVersion: 2 } },
      ]) {
        const reply = await app.inject({ method: "POST", url: "/realtime/sessions", payload: { ...payload(), ...extra } });
        expect(reply.statusCode).toBe(400);
        expect(effects()).toEqual(before);
      }
    } finally { await app.close(); }
  });

  it("preserves legacy save/finalize while rejecting new sync and cross-operation payloads", async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({ method: "POST", url: "/realtime/sessions", payload: payload() });
      expect(created.statusCode).toBe(200);
      expect(created.json()).not.toHaveProperty("processing");
      const sessionId = created.json().sessionId;
      const segments = [{ id: "s1", sourceText: "你好", translatedText: "Hello" }];
      const before = effects();
      const rejected = [
        { url: "/sessions/" + sessionId + "/segments", payload: { segments, operation: "sync", sync: { contractVersion: 1 } }, status: 503 },
        { url: "/sessions/" + sessionId + "/segments", payload: { segments, operation: "finalize" }, status: 409 },
        { url: "/realtime/sessions/" + sessionId + "/finalize", payload: { segments, operation: "sync" }, status: 409 },
        { url: "/realtime/sessions/" + sessionId + "/finalize", payload: { segments, stopWatermark: {} }, status: 503 },
      ];
      for (const request of rejected) {
        const reply = await app.inject({ method: "POST", url: request.url, payload: request.payload });
        expect(reply.statusCode).toBe(request.status);
        expect(effects()).toEqual(before);
      }
      const saved = await app.inject({ method: "POST", url: "/sessions/" + sessionId + "/segments", payload: { segments } });
      expect(saved.statusCode).toBe(200);
      const finalization = { sessionId, idempotencyKey: "finalize:" + sessionId, segments, billableSeconds: 0 };
      const ended = await app.inject({ method: "POST", url: "/realtime/sessions/" + sessionId + "/finalize", payload: finalization });
      expect(ended.statusCode).toBe(200);
      const afterEnd = effects();
      const repeated = await app.inject({ method: "POST", url: "/realtime/sessions/" + sessionId + "/finalize", payload: finalization });
      expect(repeated.statusCode).toBe(200);
      expect(effects()).toEqual(afterEnd);
    } finally { await app.close(); }
  });
});
