import { describe, expect, it } from "vitest";
import type { AsrProvider } from "../../asr/asr-provider.js";
import { LmStudioRealtimeProvider } from "./lmstudio-realtime-provider.js";

describe("lmstudio realtime provider", () => {
  it("translates transcripts emitted by the asr provider", async () => {
    const translateInputs: unknown[] = [];
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "qwen2.7-7b-instruct-qwq-prime-1k",
      timeoutMs: 100,
      translationClient: {
        translate: async (input) => {
          translateInputs.push(input);
          return "你好，这是一次实时翻译测试。";
        },
        healthCheck: async () => true,
      },
    });

    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "en",
      targetLanguage: "zh",
      voiceOutput: false,
    });

    const events = [];
    for await (const event of provider.sendAudio({
      type: "audio.frame",
      sessionId: "sess_1",
      sequence: 8,
      timestampMs: 1,
      format: "pcm16",
      sampleRate: 24000,
      data: "AA==",
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
    expect(events[1]).toMatchObject({
      providerUsage: {
        provider: "lmstudio",
        model: "qwen2.7-7b-instruct-qwq-prime-1k",
      },
    });
    expect(events[1].providerUsage?.estimatedTotalTokens).toBeGreaterThan(1);
    expect(translateInputs[0]).toEqual({
      text: "hello, this is a realtime translation test",
      sourceLanguage: "en",
      targetLanguage: "zh",
    });
  });

  it("flushes and translates buffered asr audio", async () => {
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "qwen2.7-7b-instruct-qwq-prime-1k",
      timeoutMs: 100,
      asrProvider: fixedAsrProvider(),
      translationClient: {
        translate: async () => "尾音已翻译。",
        healthCheck: async () => true,
      },
    });

    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "en",
      targetLanguage: "zh",
      voiceOutput: false,
    });

    const events = [];
    for await (const event of provider.flushSession("sess_1")) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
    expect(events[0]).toMatchObject({
      segmentId: "asr_flush_9",
      text: "tail audio",
    });
  });

  it("buffers incomplete ASR segments before translating the completed sentence", async () => {
    const translateInputs: unknown[] = [];
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "tencent/Hy-MT2-1.8B",
      timeoutMs: 100,
      asrProvider: queuedAsrProvider([
        {
          segmentId: "asr_seg_1",
          text: "今天下午三点我们在会议讨论产品计划之后",
          language: "zh",
          confidence: 0.92,
        },
        {
          segmentId: "asr_seg_2",
          text: "我会整理会议记录发给大家",
          language: "zh",
          confidence: 0.87,
        },
      ]),
      translationClient: {
        translate: async (input) => {
          translateInputs.push(input);
          return "After discussing the product plan at three this afternoon, I will send everyone the meeting notes.";
        },
        healthCheck: async () => true,
      },
    });

    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "zh",
      targetLanguage: "en",
      voiceOutput: false,
    });

    const firstEvents = [];
    for await (const event of provider.sendAudio(audioFrame(1))) {
      firstEvents.push(event);
    }

    expect(firstEvents.map((event) => event.type)).toEqual([
      "transcript.partial",
    ]);
    expect(firstEvents[0]).toMatchObject({
      segmentId: "asr_seg_1",
      text: "今天下午三点我们在会议讨论产品计划之后",
    });
    expect(translateInputs).toEqual([]);

    const secondEvents = [];
    for await (const event of provider.sendAudio(audioFrame(2))) {
      secondEvents.push(event);
    }

    expect(secondEvents.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
    expect(secondEvents[0]).toMatchObject({
      segmentId: "asr_seg_1",
      text: "今天下午三点我们在会议讨论产品计划之后我会整理会议记录发给大家",
      confidence: 0.87,
    });
    expect(translateInputs[0]).toEqual({
      text: "今天下午三点我们在会议讨论产品计划之后我会整理会议记录发给大家",
      sourceLanguage: "zh",
      targetLanguage: "en",
    });
  });

  it("flushes pending semantic segments when the realtime session ends", async () => {
    const translateInputs: unknown[] = [];
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "tencent/Hy-MT2-1.8B",
      timeoutMs: 100,
      asrProvider: queuedAsrProvider([{
        segmentId: "asr_seg_1",
        text: "this is",
        language: "en",
        confidence: 0.91,
      }]),
      translationClient: {
        translate: async (input) => {
          translateInputs.push(input);
          return "这是";
        },
        healthCheck: async () => true,
      },
    });

    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "en",
      targetLanguage: "zh",
      voiceOutput: false,
    });

    const firstEvents = [];
    for await (const event of provider.sendAudio(audioFrame(1))) {
      firstEvents.push(event);
    }
    expect(firstEvents.map((event) => event.type)).toEqual(["transcript.partial"]);

    const flushEvents = [];
    for await (const event of provider.flushSession("sess_1")) {
      flushEvents.push(event);
    }

    expect(flushEvents.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
    expect(translateInputs[0]).toMatchObject({ text: "this is" });
  });

  it("emits non-fatal translation failures", async () => {
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "qwen/qwen3.5-9b",
      timeoutMs: 100,
      asrProvider: fixedAsrProvider(),
      translationClient: {
        translate: async () => {
          throw new Error("empty translation");
        },
        healthCheck: async () => true,
      },
    });

    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "en",
      targetLanguage: "zh",
      voiceOutput: false,
    });

    const events = [];
    for await (const event of provider.sendAudio({
      type: "audio.frame",
      sessionId: "sess_1",
      sequence: 8,
      timestampMs: 1,
      format: "pcm16",
      sampleRate: 24000,
      data: "AA==",
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.failed",
    ]);
    expect(events[1]).toMatchObject({
      segmentId: "asr_seg_8",
      message: "翻译暂不可用",
      provider: "lmstudio",
      stage: "translation",
      retryable: true,
    });
  });

  it("marks ASR provider errors with diagnostic stage metadata", async () => {
    const provider = new LmStudioRealtimeProvider({
      providerName: "hymt2_self_hosted",
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "tencent/Hy-MT2-1.8B",
      timeoutMs: 100,
      asrProvider: {
        ...fixedAsrProvider(),
        transcribe: async () => { throw new Error("ASR network connection failed"); },
      },
      translationClient: { translate: async () => "unused", healthCheck: async () => true },
    });

    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "zh",
      targetLanguage: "en",
      voiceOutput: false,
    });

    const events = [];
    for await (const event of provider.sendAudio({
      type: "audio.frame",
      sessionId: "sess_1",
      sequence: 8,
      timestampMs: 1,
      format: "pcm16",
      sampleRate: 24000,
      data: "AA==",
    })) {
      events.push(event);
    }

    expect(events).toEqual([{
      type: "error",
      sessionId: "sess_1",
      code: "provider_unavailable",
      message: "ASR network connection failed",
      provider: "hymt2_self_hosted",
      stage: "asr",
      retryable: true,
    }]);
  });

});

function fixedAsrProvider(text = "hello, this is a realtime translation test"): AsrProvider {
  return {
    createSession: async () => undefined,
    transcribe: async () => ({
      segmentId: "asr_seg_8",
      text,
      language: "en",
      confidence: 0.9,
    }),
    flush: async () => ({
      segmentId: "asr_flush_9",
      text: "tail audio",
      language: "en",
      confidence: 0.8,
    }),
    closeSession: async () => undefined,
    healthCheck: async () => true,
  };
}

function queuedAsrProvider(results: Array<{
  segmentId: string;
  text: string;
  language: "en" | "zh";
  confidence?: number;
}>): AsrProvider {
  const queue = [...results];
  return {
    createSession: async () => undefined,
    transcribe: async () => queue.shift() ?? null,
    flush: async () => null,
    closeSession: async () => undefined,
    healthCheck: async () => true,
  };
}

function audioFrame(sequence: number) {
  return {
    type: "audio.frame" as const,
    sessionId: "sess_1",
    sequence,
    timestampMs: sequence,
    format: "pcm16" as const,
    sampleRate: 24000,
    data: "AA==",
  };
}
