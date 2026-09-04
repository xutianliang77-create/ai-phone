import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEnv } from "../config/env.js";
import { HttpTtsSynthesizer } from "./http-tts-synthesizer.js";

describe("http tts synthesizer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns a VoxCPM2 response into realtime audio output", async () => {
    const requests: unknown[] = [];
    const synthesizer = new HttpTtsSynthesizer({
      ...baseEnv(),
      ttsHttpEndpoint: "http://models.local:8002/tts/synthesize",
      ttsHttpApiKey: "tts-key",
    });
    vi.stubGlobal("fetch", async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        headers: init?.headers,
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({
        provider: "voxcpm2",
        model: "VoxCPM2",
        audio: {
          format: "pcm16",
          sampleRate: 24000,
          data: "AA==",
        },
      }));
    });

    const audio = await synthesizer.synthesize(
      {
        type: "translation.final",
        sessionId: "sess_1",
        segmentId: "seg_1",
        text: "Hola",
        language: "es",
      },
      {
        mode: "preset",
        presetId: "zh_female_cantonese",
      },
    );

    expect(audio).toEqual({
      type: "audio.output",
      sessionId: "sess_1",
      segmentId: "seg_1",
      format: "pcm16",
      sampleRate: 24000,
      sequence: 1,
      data: "AA==",
    });
    expect(requests[0]).toMatchObject({
      headers: {
        authorization: "Bearer tts-key",
        "content-type": "application/json",
      },
      body: {
        text: "Hola",
        language: "es",
        speakerRole: "guest",
        segmentId: "seg_1",
        voice: {
          mode: "preset",
          presetId: "zh_female_cantonese",
        },
      },
    });
  });

  it("emits an 800ms prefill and one remainder from the streaming endpoint", async () => {
    const synthesizer = new HttpTtsSynthesizer({
      ...baseEnv(),
      ttsHttpStreamEndpoint: "http://models.local:8002/tts/stream",
      ttsStreamPrefillMs: 800,
    });
    const pcm = Buffer.alloc(7_680).toString("base64");
    const events = [
      { type: "metadata", firstAudioMs: 25 },
      ...Array.from({ length: 7 }, (_, index) => ({
        type: "audio_chunk",
        format: "pcm16",
        sampleRate: 24_000,
        sequence: index + 1,
        data: pcm,
      })),
      { type: "final", audioDurationMs: 1120 },
    ];
    vi.stubGlobal("fetch", async () => new Response(
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    ));

    const audio = [];
    for await (const chunk of synthesizer.synthesizeStream(translation("seg_stream"))) {
      audio.push(chunk);
    }

    expect(audio).toHaveLength(2);
    expect(audio.map((chunk) => Buffer.from(chunk.data, "base64").length))
      .toEqual([38_400, 15_360]);
    expect(audio.map((chunk) => chunk.sequence)).toEqual([1, 2]);
  });

  it("aborts an in-flight request when its session closes", async () => {
    const synthesizer = new HttpTtsSynthesizer({
      ...baseEnv(),
      ttsHttpEndpoint: "http://models.local:8002/tts/synthesize",
    });
    let requestSignal: AbortSignal | null = null;
    vi.stubGlobal("fetch", async (_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal ?? null;
      return await new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });

    const pending = synthesizer.synthesize({
      type: "translation.final",
      sessionId: "sess_abort",
      segmentId: "seg_1",
      text: "hello",
      language: "en",
    });
    await vi.waitFor(() => expect(requestSignal).not.toBeNull());
    synthesizer.closeSession("sess_abort");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("keeps output sequence across pause cancellation and resets on close", async () => {
    const synthesizer = new HttpTtsSynthesizer({
      ...baseEnv(),
      ttsHttpEndpoint: "http://models.local:8002/tts/synthesize",
    });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      audio: { format: "pcm16", sampleRate: 24000, data: "AA==" },
    })));

    expect((await synthesizer.synthesize(translation("seg_1")))?.sequence).toBe(1);
    synthesizer.cancelSession("sess_sequence");
    expect((await synthesizer.synthesize(translation("seg_2")))?.sequence).toBe(2);
    synthesizer.closeSession("sess_sequence");
    expect((await synthesizer.synthesize(translation("seg_3")))?.sequence).toBe(1);
  });
});

function translation(segmentId: string) {
  return {
    type: "translation.final" as const,
    sessionId: "sess_sequence",
    segmentId,
    text: "hello",
    language: "en",
  };
}

function baseEnv(): RealtimeEnv {
  return {
    port: 3001,
    realtimeTokenSecret: "secret",
    provider: "hymt2_self_hosted",
    resolvedProvider: "lmstudio",
    regionEdition: "domestic",
    dataRegion: "cn",
    callProviderPolicy: "call_link_only",
    complianceProfile: "pipl",
    asrProvider: "http",
    openAiRealtimeEndpoint: "",
    openAiRealtimeModel: "",
    openAiInputTranscriptionModel: "",
    openAiConnectTimeoutMs: 100,
    lmStudioBaseUrl: "http://models.local:8003/v1",
    lmStudioModel: "tencent/Hy-MT2-1.8B",
    lmStudioTimeoutMs: 100,
    lmStudioMaxTokens: 512,
    qwenBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    qwenModel: "qwen-plus",
    qwenTimeoutMs: 100,
    qwenMaxTokens: 512,
    asrHttpEndpoint: "http://models.local:8021/asr/transcribe",
    asrHttpTimeoutMs: 100,
    ttsHttpTimeoutMs: 100,
    ttsStreamPrefillMs: 800,
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
}
