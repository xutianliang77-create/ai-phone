import { describe, expect, it } from "vitest";
import { LmStudioRealtimeProvider } from "./lmstudio-realtime-provider.js";

describe("lmstudio realtime provider text input", () => {
  it("translates final text segments from mobile system ASR", async () => {
    const translateInputs: unknown[] = [];
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "qwen/qwen3.5-9b",
      timeoutMs: 100,
      translationClient: {
        translate: async (input) => {
          translateInputs.push(input);
          return "早上好";
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
    for await (const event of provider.sendText({
      sessionId: "sess_1",
      segmentId: "native_1",
      text: "good morning",
      language: "en",
      isFinal: true,
      confidence: 0.95,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
    expect(events[1].providerUsage).toMatchObject({
      provider: "lmstudio",
      model: "qwen/qwen3.5-9b",
    });
    expect(translateInputs[0]).toEqual({
      text: "good morning",
      sourceLanguage: "en",
      targetLanguage: "zh",
    });
  });

  it("auto reverses target language per transcript language", async () => {
    const translateInputs: unknown[] = [];
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "hymt2",
      timeoutMs: 100,
      translationClient: {
        translate: async (input) => {
          translateInputs.push(input);
          return input.targetLanguage === "zh" ? "你好" : "hello";
        },
        healthCheck: async () => true,
      },
    });

    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "auto",
      targetLanguage: "zh",
      autoReverseTargetLanguage: true,
      voiceOutput: false,
    });

    for await (const _event of provider.sendText({
      sessionId: "sess_1",
      segmentId: "native_en_1",
      text: "hello",
      language: "en",
      isFinal: true,
    })) {
    }
    for await (const _event of provider.sendText({
      sessionId: "sess_1",
      segmentId: "native_zh_1",
      text: "你好",
      language: "zh",
      isFinal: true,
    })) {
    }

    expect(translateInputs).toMatchObject([
      { sourceLanguage: "en", targetLanguage: "zh" },
      { sourceLanguage: "zh", targetLanguage: "en" },
    ]);
  });

  it("preserves short spelled identifiers instead of treating them as failed English translation", async () => {
    const translateInputs: unknown[] = [];
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "hymt2",
      timeoutMs: 100,
      translationClient: {
        translate: async (input) => {
          translateInputs.push(input);
          return "unused";
        },
        healthCheck: async () => true,
      },
    });

    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "auto",
      targetLanguage: "zh",
      autoReverseTargetLanguage: true,
      voiceOutput: false,
    });

    const events = [];
    for await (const event of provider.sendText({
      sessionId: "sess_1",
      segmentId: "native_code_1",
      text: "A E Q",
      language: "en",
      isFinal: true,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
    expect(events[1]).toMatchObject({
      text: "A E Q",
      language: "zh",
      providerUsage: {
        provider: "local_identifier_preserve",
        model: "spelled-identifier",
        latencyMs: 0,
      },
    });
    expect(translateInputs).toEqual([]);
  });

  it("passes matching active terminology to the translation client", async () => {
    const translateInputs: unknown[] = [];
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "qwen",
      timeoutMs: 100,
      translationClient: {
        translate: async (input) => {
          translateInputs.push(input);
          return "subtitles";
        },
        healthCheck: async () => true,
      },
    });

    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "zh",
      targetLanguage: "en",
      voiceOutput: false,
      terminology: [{
        id: "term_1",
        sourceText: "字幕",
        translatedText: "subtitles",
        sourceLanguage: "zh",
        targetLanguage: "en",
        status: "active",
        createdAt: "2026-07-03T00:00:00.000Z",
        updatedAt: "2026-07-03T00:00:00.000Z",
      }],
    });

    for await (const _event of provider.sendText({
      sessionId: "sess_1",
      segmentId: "native_zh_1",
      text: "字幕",
      language: "zh",
      isFinal: true,
    })) {
    }

    expect(translateInputs[0]).toMatchObject({
      targetLanguage: "en",
      terminology: [{ sourceText: "字幕", translatedText: "subtitles" }],
    });
  });
});
