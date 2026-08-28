import { describe, expect, it } from "vitest";
import type { RealtimeEnv } from "../config/env.js";
import { ProviderRouter } from "./provider-router.js";

const baseEnv: RealtimeEnv = {
  port: 3001,
  allowedHosts: ["localhost:3001"],
  allowedOrigins: [],
  allowNonBrowserClientsWithoutOrigin: false,
  trustProxyAddresses: ["127.0.0.1", "::1"],
  maxPayloadBytes: 65_536,
  maxConnections: 512,
  maxConnectionsPerIp: 8,
  maxSessions: 256,
  maxMessagesPerSecond: 120,
  maxAudioFramesPerSecond: 75,
  maxPendingAudioMs: 6000,
  maxPendingControlEvents: 32,
  maxPendingTtsOutputs: 32,
  handshakeRateLimitPerMinute: 30,
  publicRateLimitProvider: "memory",
  publicRateLimitKeyPrefix: "test:gateway",
  publicRateLimitKeySecret: "test-only",
  publicRateLimitConnectTimeoutMs: 250,
  realtimeTokenSecret: "secret",
  provider: "mock",
  resolvedProvider: "mock",
  regionEdition: "domestic",
  dataRegion: "cn",
  callProviderPolicy: "call_link_only",
  complianceProfile: "pipl",
  asrProvider: "mock",
  openAiRealtimeEndpoint: "wss://api.openai.com/v1/realtime/translations",
  openAiRealtimeModel: "gpt-realtime-translate",
  openAiInputTranscriptionModel: "gpt-4o-mini-transcribe",
  openAiConnectTimeoutMs: 100,
  lmStudioBaseUrl: "http://127.0.0.1:1234",
  lmStudioModel: "tencent/Hy-MT2-1.8B",
  lmStudioTimeoutMs: 100,
  lmStudioMaxTokens: 512,
  qwenBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  qwenModel: "qwen-plus",
  qwenApiKey: "qwen-key",
  qwenTimeoutMs: 100,
  qwenMaxTokens: 512,
  asrHttpTimeoutMs: 100,
  ttsHttpTimeoutMs: 100,
  sessionEventSink: "noop",
  apiBaseUrl: "http://127.0.0.1:3100",
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

describe("provider router", () => {
  it("uses mock provider by default", () => {
    const provider = new ProviderRouter().selectProvider(baseEnv);

    expect(provider.name).toBe("mock");
  });

  it("uses openai provider when configured", () => {
    const provider = new ProviderRouter().selectProvider({
      ...baseEnv,
      provider: "openai",
      resolvedProvider: "openai",
      openAiApiKey: "test-key",
    });

    expect(provider.name).toBe("openai");
  });

  it("rejects openai provider without an api key", () => {
    expect(() => new ProviderRouter().selectProvider({
      ...baseEnv,
      provider: "openai",
      resolvedProvider: "openai",
    })).toThrow("OPENAI_API_KEY");
  });

  it("uses lmstudio provider when configured", () => {
    const provider = new ProviderRouter().selectProvider({
      ...baseEnv,
      provider: "lmstudio",
      resolvedProvider: "lmstudio",
    });

    expect(provider.name).toBe("lmstudio");
  });

  it("maps domestic self-hosted provider alias to self-hosted provider", () => {
    const provider = new ProviderRouter().selectProvider({
      ...baseEnv,
      provider: "self_hosted",
      resolvedProvider: "lmstudio",
    });

    expect(provider.name).toBe("self_hosted");
  });

  it("maps Hy-MT2 self-hosted provider alias to self-hosted provider", () => {
    const provider = new ProviderRouter().selectProvider({
      ...baseEnv,
      provider: "hymt2_self_hosted",
      resolvedProvider: "lmstudio",
    });

    expect(provider.name).toBe("hymt2_self_hosted");
  });

  it("uses qwen live provider when configured", () => {
    const provider = new ProviderRouter().selectProvider({
      ...baseEnv,
      provider: "qwen_live",
      resolvedProvider: "qwen_live",
    });

    expect(provider.name).toBe("qwen_live");
  });

  it("rejects qwen live provider without an api key", () => {
    expect(() => new ProviderRouter().selectProvider({
      ...baseEnv,
      provider: "qwen_live",
      resolvedProvider: "qwen_live",
      qwenApiKey: undefined,
    })).toThrow("QWEN_API_KEY");
  });

  it("rejects tencent trtc provider until the media adapter is implemented", () => {
    expect(() => new ProviderRouter().selectProvider({
      ...baseEnv,
      provider: "tencent_trtc",
      resolvedProvider: "unsupported",
    })).toThrow("tencent_trtc");
  });

  it("requires an http asr endpoint when lmstudio uses http asr", () => {
    expect(() => new ProviderRouter().selectProvider({
      ...baseEnv,
      provider: "lmstudio",
      resolvedProvider: "lmstudio",
      asrProvider: "http",
    })).toThrow("ASR_HTTP_ENDPOINT");
  });
});
