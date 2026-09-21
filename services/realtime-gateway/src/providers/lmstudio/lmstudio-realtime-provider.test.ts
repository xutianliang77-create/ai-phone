import { fixedAsrProvider, queuedAsrProvider, audioFrame } from "./lmstudio-realtime-provider-fixtures.test-support.js";
import { describe, expect, it, vi } from "vitest";
import { LmStudioRealtimeProvider } from "./lmstudio-realtime-provider.js";
import { PublicTranslationError } from "./lmstudio-public-protocol.js";
import { realtimeLogger } from "../../metrics/realtime-metrics.js";

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
      "transcript.final",
      "translation.final",
    ]);
    expect(secondEvents[0]).toMatchObject({
      segmentId: "asr_seg_2", text: "",
    });
    expect(secondEvents[1]).toMatchObject({
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

  it("records a safe public failure classification before yielding translation.failed", async () => {
    const warn = vi.spyOn(realtimeLogger, "warn").mockImplementation(() => realtimeLogger);
    try {
      const provider = new LmStudioRealtimeProvider({
        baseUrl: "http://127.0.0.1:1234/v1",
        model: "service:tencent_tmt",
        timeoutMs: 100,
        asrProvider: fixedAsrProvider(),
        translationClient: {
          translate: async () => {
            throw new PublicTranslationError(
              "public_translation_http_error",
              "uncertain",
              503,
              { requestId: "request-42" },
            );
          },
          healthCheck: async () => true,
        },
      });
      await provider.createSession({
        sessionId: "sess_1", sourceLanguage: "en", targetLanguage: "zh", voiceOutput: false,
      });

      const iterator = provider.sendAudio(audioFrame(8));
      expect((await iterator.next()).value).toMatchObject({ type: "transcript.final" });
      expect((await iterator.next()).value).toMatchObject({ type: "translation.failed" });
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: "sess_1",
        segmentId: "asr_seg_8",
        failure: {
          class: "public_translation",
          code: "public_translation_http_error",
          outcome: "uncertain",
          httpStatus: 503,
          requestId: "request-42",
        },
      }), "Realtime translation failed");
    } finally {
      warn.mockRestore();
    }
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
