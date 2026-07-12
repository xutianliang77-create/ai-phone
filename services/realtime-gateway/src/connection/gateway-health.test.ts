import { describe, expect, it } from "vitest";
import type { RealtimeEnv } from "../config/env.js";
import { gatewayHealthPayload, gatewayReleaseReadinessPayload } from "./gateway-health.js";

const env: RealtimeEnv = {
  port: 3001,
  realtimeTokenSecret: "secret",
  provider: "lmstudio",
  resolvedProvider: "lmstudio",
  regionEdition: "domestic",
  dataRegion: "cn",
  callProviderPolicy: "call_link_only",
  complianceProfile: "pipl",
  asrProvider: "http",
  speakerProvider: "http",
  openAiRealtimeEndpoint: "wss://api.openai.com/v1/realtime/translations",
  openAiRealtimeModel: "gpt-realtime-translate",
  openAiInputTranscriptionModel: "gpt-4o-mini-transcribe",
  openAiConnectTimeoutMs: 100,
  lmStudioBaseUrl: "http://127.0.0.1:1234/v1",
  lmStudioModel: "tencent/Hy-MT2-1.8B",
  lmStudioTimeoutMs: 100,
  lmStudioMaxTokens: 512,
  qwenBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  qwenModel: "qwen-plus",
  qwenApiKey: "qwen-key",
  qwenTimeoutMs: 100,
  qwenMaxTokens: 512,
  asrHttpEndpoint: "http://127.0.0.1:8001/asr/transcribe",
  asrHttpApiKey: "1234567890abcdef",
  asrHttpTimeoutMs: 100,
  speakerHttpBaseUrl: "http://127.0.0.1:8022",
  speakerHttpTimeoutMs: 2000,
  ttsHttpTimeoutMs: 100,
  sessionEventSink: "api",
  apiBaseUrl: "http://127.0.0.1:3100",
  internalApiSecret: "1234567890abcdef",
  sessionSyncTimeoutMs: 100,
  llmProvider: "off",
  llmRefinementEnabled: false,
  llmReviewEnabled: false,
  llmCorrectionTimeoutMs: 100,
  llmReviewTimeoutMs: 100,
  llmCorrectionMaxTokens: 128,
  llmReviewMaxTokens: 128,
  llmTemperature: 0,
  llmMinConfidence: 0.72,
  domainLexiconPacks: [],
};

describe("gateway health", () => {
  it("reports gateway runtime routing settings", () => {
    expect(gatewayHealthPayload(env)).toEqual({
      status: "ok",
      service: "realtime-gateway",
      version: "0.1.0",
      provider: "lmstudio",
      resolvedProvider: "lmstudio",
      regionEdition: "domestic",
      dataRegion: "cn",
      callProviderPolicy: "call_link_only",
      complianceProfile: "pipl",
      asrProvider: "http",
      speakerProvider: "http",
      speakerEndpoint: "http://127.0.0.1:8022",
      speakerTimeoutMs: 2000,
      asrEndpoint: "http://127.0.0.1:8001/asr/transcribe",
      asrHealthUrl: undefined,
      translationEndpoint: "http://127.0.0.1:1234/v1",
      translationModel: "tencent/Hy-MT2-1.8B",
      sessionEventSink: "api",
      releaseReadiness: {
        status: "not_ready",
        profile: "domestic",
        issues: [
          "Domestic release requires REALTIME_PROVIDER=qwen_live, self_hosted, or hymt2_self_hosted",
        ],
      },
    });
  });

  it("passes release readiness for configured domestic qwen provider", () => {
    expect(gatewayReleaseReadinessPayload({
      ...env,
      provider: "qwen_live",
      resolvedProvider: "qwen_live",
    })).toEqual({
      status: "ready",
      profile: "domestic",
      issues: [],
    });
  });

  it("passes release readiness for configured domestic Hy-MT2 provider", () => {
    expect(gatewayReleaseReadinessPayload({
      ...env,
      provider: "hymt2_self_hosted",
      resolvedProvider: "lmstudio",
    })).toEqual({
      status: "ready",
      profile: "domestic",
      issues: [],
    });
  });

  it("blocks release readiness for mock runtime settings", () => {
    const payload = gatewayReleaseReadinessPayload({
      ...env,
      provider: "mock",
      resolvedProvider: "mock",
      asrProvider: "mock",
      sessionEventSink: "noop",
      internalApiSecret: undefined,
    });

    expect(payload.status).toBe("not_ready");
    expect(payload.issues).toContain(
      "Domestic release requires REALTIME_PROVIDER=qwen_live, self_hosted, or hymt2_self_hosted",
    );
    expect(payload.issues).toContain("Release requires ASR_PROVIDER=http");
    expect(payload.issues).toContain("Release requires SESSION_EVENT_SINK=api");
    expect(payload.issues).toContain(
      "Release requires INTERNAL_API_SECRET with at least 16 characters",
    );
  });

  it("requires an ASR HTTP API key for release", () => {
    const payload = gatewayReleaseReadinessPayload({
      ...env,
      provider: "hymt2_self_hosted",
      resolvedProvider: "lmstudio",
      asrHttpApiKey: "short",
    });

    expect(payload.issues).toContain(
      "Release requires ASR_HTTP_API_KEY with at least 16 characters",
    );
  });

  it("requires Hy-MT2 model for Hy-MT2 release provider", () => {
    const payload = gatewayReleaseReadinessPayload({
      ...env,
      provider: "hymt2_self_hosted",
      resolvedProvider: "lmstudio",
      lmStudioModel: "qwen/qwen3.5-9b",
    });

    expect(payload.issues).toContain(
      "TRANSLATION_MODEL must be tencent/Hy-MT2-1.8B for hymt2_self_hosted release",
    );
  });
});
