import { describe, expect, it } from "vitest";
import type { RealtimeTokenClaims } from "@translation/contracts";
import type { RealtimeEnv } from "../config/env.js";
import { fetchSessionTerminology } from "./session-terminology.js";

describe("session terminology", () => {
  it("loads active terms for realtime sessions without exposing them in tokens", async () => {
    let requestedUrl = "";
    let authorization = "";
    const terms = await fetchSessionTerminology(
      claims(),
      env(),
      (async (url: URL, init?: RequestInit) => {
        requestedUrl = url.toString();
        const headers = init?.headers as Record<string, string> | undefined;
        authorization = String(headers?.authorization ?? "");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            terms: [{
              id: "term_1",
              sourceText: "字幕",
              translatedText: "subtitles",
              sourceLanguage: "zh",
              targetLanguage: "en",
              status: "active",
              createdAt: "2026-07-03T00:00:00.000Z",
              updatedAt: "2026-07-03T00:00:00.000Z",
            }],
          }),
        };
      }) as unknown as typeof fetch,
    );

    expect(requestedUrl).toContain("/internal/termbase/terms?");
    expect(requestedUrl).toContain("termbaseId=default");
    expect(requestedUrl).toContain("targetLanguage=en");
    expect(authorization).toBe("Bearer internal-secret");
    expect(terms[0]?.translatedText).toBe("subtitles");
  });

  it("skips lookup when no termbase is selected", async () => {
    const terms = await fetchSessionTerminology(
      { ...claims(), termbaseId: undefined },
      env(),
      (async () => {
        throw new Error("fetch should not be called");
      }) as typeof fetch,
    );

    expect(terms).toEqual([]);
  });
});

function claims(): RealtimeTokenClaims {
  return {
    userId: "guest-user",
    sessionId: "sess_1",
    sourceLanguage: "zh",
    targetLanguage: "en",
    voiceOutput: true,
    planCode: "free",
    termbaseId: "default",
    maxDurationSeconds: 1800,
    issuedAt: 1,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  };
}

function env(): RealtimeEnv {
  return {
    port: 3101,
    realtimeTokenSecret: "secret",
    provider: "lmstudio",
    resolvedProvider: "lmstudio",
    regionEdition: "domestic",
    dataRegion: "cn",
    callProviderPolicy: "call_link_only",
    complianceProfile: "pipl",
    asrProvider: "mock",
    openAiRealtimeEndpoint: "",
    openAiRealtimeModel: "",
    openAiInputTranscriptionModel: "",
    openAiConnectTimeoutMs: 1000,
    lmStudioBaseUrl: "http://127.0.0.1:1234",
    lmStudioModel: "qwen",
    lmStudioTimeoutMs: 1000,
    lmStudioMaxTokens: 512,
    qwenBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    qwenModel: "qwen-plus",
    qwenTimeoutMs: 1000,
    qwenMaxTokens: 512,
    asrHttpTimeoutMs: 1000,
    ttsHttpTimeoutMs: 1000,
    sessionEventSink: "api",
    apiBaseUrl: "http://127.0.0.1:3100",
    internalApiSecret: "internal-secret",
    sessionSyncTimeoutMs: 1000,
    llmProvider: "off",
    llmRefinementEnabled: false,
    llmReviewEnabled: false,
    llmCorrectionTimeoutMs: 2500,
    llmReviewTimeoutMs: 30_000,
    llmCorrectionMaxTokens: 384,
    llmReviewMaxTokens: 2048,
    llmTemperature: 0,
    llmMinConfidence: 0.72,
    domainLexiconPacks: [],
  };
}
