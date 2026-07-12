import { describe, expect, it } from "vitest";
import { createSessionEventSink } from "./session-event-sink.js";
import type { RealtimeEnv } from "../config/env.js";

describe("session event sink", () => {
  it("syncs started, paused, and resumed states to the api", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response("{}", { status: 200 });
    };

    try {
      const sink = createSessionEventSink({
        ...baseEnv(),
        sessionEventSink: "api",
        apiBaseUrl: "http://127.0.0.1:3100",
      });
      await sink.record({ type: "session.started", sessionId: "sess_1" });
      await sink.record({ type: "session.paused", sessionId: "sess_1" });
      await sink.record({ type: "session.resumed", sessionId: "sess_1" });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:3100/internal/realtime/sessions/sess_1/state",
        body: { status: "active" },
      },
      {
        url: "http://127.0.0.1:3100/internal/realtime/sessions/sess_1/state",
        body: { status: "paused" },
      },
      {
        url: "http://127.0.0.1:3100/internal/realtime/sessions/sess_1/state",
        body: { status: "active" },
      },
    ]);
  });

  it("posts final transcript, translation, and ended events to the api", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response("{}", { status: 200 });
    };

    try {
      const sink = createSessionEventSink({
        ...baseEnv(),
        sessionEventSink: "api",
        apiBaseUrl: "http://127.0.0.1:3100",
      });

      await sink.record({
        type: "transcript.final",
        sessionId: "sess_1",
        segmentId: "seg_1",
        text: "hello",
        language: "en",
        confidence: 0.91,
      });
      await sink.record({
        type: "translation.final",
        sessionId: "sess_1",
        segmentId: "seg_1",
        text: "你好",
        language: "zh",
        providerUsage: {
          provider: "qwen_live",
          model: "qwen-plus",
          latencyMs: 380,
          estimatedTotalTokens: 8,
        },
      });
      await sink.record({
        type: "session.ended",
        sessionId: "sess_1",
        reason: "quota_exhausted",
        billableSeconds: 45,
        remainingSeconds: 0,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:3100/internal/realtime/segments",
        body: {
          sessionId: "sess_1",
          segmentId: "seg_1",
          sourceText: "hello",
          rawText: "hello",
          sourceLanguage: "en",
          confidence: 0.91,
          stage: "asr",
        },
      },
      {
        url: "http://127.0.0.1:3100/internal/realtime/segments",
        body: {
          sessionId: "sess_1",
          segmentId: "seg_1",
          translatedText: "你好",
          targetLanguage: "zh",
          stage: "translation",
          provider: "qwen_live",
          model: "qwen-plus",
          latencyMs: 380,
          providerUsage: {
            provider: "qwen_live",
            model: "qwen-plus",
            latencyMs: 380,
            estimatedTotalTokens: 8,
          },
        },
      },
      {
        url: "http://127.0.0.1:3100/internal/realtime/sessions/sess_1/end",
        body: { billableSeconds: 45 },
      },
    ]);
  });

  it("does not sync realtime silence markers to the api", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response("{}", { status: 200 });
    };

    try {
      const sink = createSessionEventSink({
        ...baseEnv(),
        sessionEventSink: "api",
        apiBaseUrl: "http://127.0.0.1:3100",
      });

      await sink.record({
        type: "transcript.final",
        sessionId: "sess_1",
        segmentId: "sil_1",
        text: "<|nospeech|>",
        language: "en",
      });
      await sink.record({
        type: "translation.final",
        sessionId: "sess_1",
        segmentId: "sil_1",
        text: "<sil>",
        language: "zh",
      });
      await sink.record({
        type: "transcript.final",
        sessionId: "sess_1",
        segmentId: "mix_1",
        text: "hello <sil>",
        language: "en",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:3100/internal/realtime/segments",
        body: {
          sessionId: "sess_1",
          segmentId: "mix_1",
          sourceText: "hello",
          rawText: "hello",
          sourceLanguage: "en",
          stage: "asr",
        },
      },
    ]);
  });

  it("retries final session settlement after transient API failures", async () => {
    var attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      attempts += 1;
      return new Response("{}", { status: attempts < 3 ? 503 : 200 });
    };

    try {
      const sink = createSessionEventSink({
        ...baseEnv(),
        sessionEventSink: "api",
        apiBaseUrl: "http://127.0.0.1:3100",
      });
      await sink.record({
        type: "session.ended",
        sessionId: "sess_retry",
        reason: "connection_closed",
        billableSeconds: 12,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(attempts).toBe(3);
  });

  it("syncs realtime session diagnostics with final settlement", async () => {
    let body: unknown;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    };

    try {
      const sink = createSessionEventSink({
        ...baseEnv(),
        sessionEventSink: "api",
        apiBaseUrl: "http://127.0.0.1:3100",
      });
      await sink.record({
        type: "session.ended",
        sessionId: "sess_diagnostics",
        diagnostics: {
          version: 1,
          audio: {
            receivedFrameCount: 8,
            processedBatchCount: 2,
            droppedFrameCount: 0,
          },
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(body).toEqual({
      diagnostics: {
        version: 1,
        audio: {
          receivedFrameCount: 8,
          processedBatchCount: 2,
          droppedFrameCount: 0,
        },
      },
    });
  });
});

function baseEnv(): RealtimeEnv {
  return {
    port: 3201,
    realtimeTokenSecret: "test-secret",
    provider: "mock",
    asrProvider: "mock",
    openAiRealtimeEndpoint: "wss://example.test/realtime",
    openAiRealtimeModel: "gpt-realtime-translate",
    openAiInputTranscriptionModel: "gpt-4o-mini-transcribe",
    openAiConnectTimeoutMs: 10_000,
    lmStudioBaseUrl: "http://127.0.0.1:1234",
    lmStudioModel: "qwen/qwen3.5-9b",
    lmStudioTimeoutMs: 20_000,
    lmStudioMaxTokens: 512,
    qwenBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    qwenModel: "qwen-plus",
    qwenTimeoutMs: 20_000,
    qwenMaxTokens: 512,
    asrHttpTimeoutMs: 10_000,
    ttsHttpTimeoutMs: 10_000,
    sessionEventSink: "noop",
    apiBaseUrl: "http://127.0.0.1:3100",
    sessionSyncTimeoutMs: 5_000,
    resolvedProvider: "mock",
    regionEdition: "domestic",
    dataRegion: "cn",
    callProviderPolicy: "call_link_only",
    complianceProfile: "pipl",
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
