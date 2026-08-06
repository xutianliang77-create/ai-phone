import { describe, expect, it } from "vitest";
import type { AsrProvider, TranscriptResult } from "../../asr/asr-provider.js";
import { LmStudioRealtimeProvider } from "./lmstudio-realtime-provider.js";


describe("lmstudio stable ASR partial", () => {
  it("publishes the partial without translation and translates only final", async () => {
    const translateInputs: unknown[] = [];
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "tencent/Hy-MT2-1.8B",
      timeoutMs: 100,
      asrProvider: queuedAsrProvider([
        {
          segmentId: "qwen3_seg_1",
          revision: 0,
          isFinal: false,
          text: "今天开会。",
          language: "zh",
        },
        {
          segmentId: "qwen3_seg_1",
          revision: 1,
          isFinal: true,
          text: "今天开会讨论产品计划。",
          language: "zh",
        },
      ]),
      translationClient: {
        translate: async (input) => {
          translateInputs.push(input);
          return "We will discuss the product plan today.";
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

    const partialEvents = [];
    for await (const event of provider.sendAudio(audioFrame(1))) {
      partialEvents.push(event);
    }
    expect(translateInputs).toEqual([]);
    const finalEvents = [];
    for await (const event of provider.sendAudio(audioFrame(2))) {
      finalEvents.push(event);
    }

    expect(partialEvents).toEqual([{
      type: "transcript.partial",
      sessionId: "sess_1",
      segmentId: "qwen3_seg_1",
      revision: 0,
      text: "今天开会。",
      language: "zh",
    }]);
    expect(translateInputs).toHaveLength(1);
    expect(finalEvents.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
    expect(finalEvents[0]).toMatchObject({
      segmentId: "qwen3_seg_1",
      revision: 1,
      text: "今天开会讨论产品计划。",
    });
  });

  it("suppresses overlap-only partials", async () => {
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "tencent/Hy-MT2-1.8B",
      timeoutMs: 100,
      asrProvider: queuedAsrProvider([{
        segmentId: "overlap_1",
        revision: 0,
        isFinal: false,
        text: "重叠诊断文本",
        language: "zh",
        timing: { overlap: true },
      }]),
      translationClient: {
        translate: async () => "must not run",
        healthCheck: async () => true,
      },
    });
    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "zh",
      targetLanguage: "en",
      voiceOutput: false,
    });

    const events = [];
    for await (const event of provider.sendAudio(audioFrame(1))) events.push(event);

    expect(events).toEqual([]);
  });
});


function queuedAsrProvider(results: TranscriptResult[]): AsrProvider {
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
