import { describe, expect, it } from "vitest";
import type { AsrProvider } from "../../asr/asr-provider.js";
import { LmStudioRealtimeProvider } from "./lmstudio-realtime-provider.js";

describe("lmstudio realtime provider transcript filter", () => {
  it("ignores ASR silence marker text segments", async () => {
    const translateInputs: unknown[] = [];
    const provider = providerWith({
      translate: async (input) => {
        translateInputs.push(input);
        return "ignored";
      },
    });

    await createSession(provider);

    const events = [];
    for await (const event of provider.sendText({
      sessionId: "sess_1",
      segmentId: "native_sil_1",
      text: "<sil>",
      language: "en",
      isFinal: true,
    })) {
      events.push(event);
    }

    expect(events).toEqual([]);
    expect(translateInputs).toEqual([]);
  });

  it("strips ASR marker text before translation", async () => {
    const translateInputs: unknown[] = [];
    const provider = providerWith({
      translate: async (input) => {
        translateInputs.push(input);
        return "你好";
      },
    });

    await createSession(provider);

    const events = [];
    for await (const event of provider.sendText({
      sessionId: "sess_1",
      segmentId: "native_mix_1",
      text: "hello <|nospeech|> world",
      language: "en",
      isFinal: true,
    })) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({ text: "hello world" });
    expect(translateInputs[0]).toMatchObject({ text: "hello world" });
  });

  it("ignores ASR silence marker audio transcripts", async () => {
    const translateInputs: unknown[] = [];
    const provider = providerWith({
      asrProvider: fixedAsrProvider("<sil>"),
      translate: async (input) => {
        translateInputs.push(input);
        return "ignored";
      },
    });

    await createSession(provider);

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

    expect(events).toEqual([]);
    expect(translateInputs).toEqual([]);
  });

  it("drops silence marker translation output", async () => {
    const provider = providerWith({
      translate: async () => "<sil>",
    });

    await createSession(provider);

    const events = [];
    for await (const event of provider.sendText({
      sessionId: "sess_1",
      segmentId: "native_1",
      text: "hello",
      language: "en",
      isFinal: true,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.failed",
    ]);
    expect(events[1]).toMatchObject({
      sessionId: "sess_1",
      segmentId: "native_1",
      message: "翻译暂不可用",
      stage: "translation",
      provider: "lmstudio",
      retryable: true,
    });
  });

  it("reports model refusal text as translation failed", async () => {
    const provider = providerWith({
      translate: async () =>
        "I'm sorry, but I need more context to provide a translation. Could you please provide the text that needs to be translated?",
    });

    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "zh",
      targetLanguage: "en",
      voiceOutput: false,
    });

    const events = [];
    for await (const event of provider.sendText({
      sessionId: "sess_1",
      segmentId: "native_refusal_1",
      text: "再读一读",
      language: "zh",
      isFinal: true,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.failed",
    ]);
    expect(events[1]).toMatchObject({
      message: "Translation unavailable",
      language: "en",
      stage: "translation",
      provider: "lmstudio",
      retryable: true,
    });
  });
});

function providerWith(options: {
  asrProvider?: AsrProvider;
  translate: (input: {
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
  }) => Promise<string>;
}) {
  return new LmStudioRealtimeProvider({
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "hymt2",
    timeoutMs: 100,
    ...(options.asrProvider ? { asrProvider: options.asrProvider } : {}),
    translationClient: {
      translate: options.translate,
      healthCheck: async () => true,
    },
  });
}

async function createSession(provider: LmStudioRealtimeProvider) {
  await provider.createSession({
    sessionId: "sess_1",
    sourceLanguage: "auto",
    targetLanguage: "zh",
    voiceOutput: false,
  });
}

function fixedAsrProvider(text: string): AsrProvider {
  return {
    createSession: async () => undefined,
    transcribe: async () => ({
      segmentId: "asr_seg_8",
      text,
      language: "en",
      confidence: 0.9,
    }),
    flush: async () => null,
    closeSession: async () => undefined,
    healthCheck: async () => true,
  };
}
