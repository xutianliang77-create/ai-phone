import { describe, expect, it } from "vitest";
import type { AsrProvider } from "../../asr/asr-provider.js";
import { LmStudioRealtimeProvider } from "./lmstudio-realtime-provider.js";

describe("lmstudio speaker boundary results", () => {
  it("preserves every transcript returned by a speaker boundary commit", async () => {
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "tencent/Hy-MT2-1.8B",
      timeoutMs: 100,
      asrProvider: boundaryAsrProvider(),
      translationClient: {
        translate: async (input) => input.text === "Hello." ? "你好。" : "早上好。",
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
    for await (const event of provider.sendAudio(audioFrame())) events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
      "transcript.final",
      "translation.final",
    ]);
    expect(events.filter((event) => event.type === "transcript.final")).toMatchObject([
      { segmentId: "turn_1", turnId: "turn_1", revision: 0, speaker: { speakerId: "speaker_1" } },
      { segmentId: "turn_2", turnId: "turn_2", revision: 0, speaker: { speakerId: "speaker_2" } },
    ]);
  });

  it("orders simultaneous ASR results by audio timing before translation", async () => {
    const provider = new LmStudioRealtimeProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "tencent/Hy-MT2-1.8B",
      timeoutMs: 100,
      asrProvider: timedOutOfOrderAsrProvider(),
      translationClient: {
        translate: async (input) => `translated:${input.text}`,
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
    for await (const event of provider.sendAudio(audioFrame())) events.push(event);

    expect(events.filter((event) => event.type === "transcript.final").map(
      (event) => event.segmentId,
    )).toEqual(["early", "late"]);
  });
});

function boundaryAsrProvider(): AsrProvider {
  return {
    createSession: async () => undefined,
    transcribe: async () => [
      transcript("turn_1", "Hello.", "speaker_1"),
      transcript("turn_2", "Good morning.", "speaker_2"),
    ],
    flush: async () => null,
    closeSession: async () => undefined,
    healthCheck: async () => true,
  };
}

function timedOutOfOrderAsrProvider(): AsrProvider {
  return {
    ...boundaryAsrProvider(),
    transcribe: async () => [
      { ...transcript("late", "Later.", "speaker_2"), timing: timing(500, 900) },
      { ...transcript("early", "Earlier.", "speaker_1"), timing: timing(0, 500) },
    ],
  };
}

function timing(startMs: number, endMs: number) {
  return { startMs, endMs, source: "client" as const };
}

function transcript(segmentId: string, text: string, speakerId: string) {
  return {
    segmentId,
    turnId: segmentId,
    revision: 0,
    text,
    language: "en" as const,
    speaker: {
      speakerId,
      role: "speaker" as const,
      source: "diarization" as const,
    },
  };
}

function audioFrame() {
  return {
    type: "audio.frame" as const,
    sessionId: "sess_1",
    sequence: 1,
    timestampMs: 1,
    format: "pcm16" as const,
    sampleRate: 24000,
    data: "AA==",
  };
}
