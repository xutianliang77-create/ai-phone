import { describe, expect, it, vi } from "vitest";
import type { AsrProvider } from "../../asr/asr-provider.js";
import { LmStudioRealtimeProvider } from "./lmstudio-realtime-provider.js";

describe("lmstudio segment timeout", () => {
  it("forces a pending segment out while silent audio continues", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1000);
      const provider = new LmStudioRealtimeProvider({
        baseUrl: "http://127.0.0.1:1234/v1",
        model: "tencent/Hy-MT2-1.8B",
        timeoutMs: 100,
        asrProvider: oneIncompleteTranscript(),
        translationClient: {
          translate: async () => "这是",
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
      for await (const event of provider.sendAudio(audioFrame(1))) firstEvents.push(event);
      expect(firstEvents.map((event) => event.type)).toEqual(["transcript.partial"]);

      vi.setSystemTime(3000);
      const expiredEvents = [];
      for await (const event of provider.sendAudio(audioFrame(2))) expiredEvents.push(event);
      expect(expiredEvents.map((event) => event.type)).toEqual([
        "transcript.final",
        "translation.final",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

function oneIncompleteTranscript(): AsrProvider {
  let emitted = false;
  return {
    createSession: async () => undefined,
    transcribe: async () => {
      if (emitted) return null;
      emitted = true;
      return { segmentId: "asr_1", text: "this is", language: "en" };
    },
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
