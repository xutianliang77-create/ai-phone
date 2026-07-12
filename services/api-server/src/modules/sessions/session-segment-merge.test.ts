import { describe, expect, it } from "vitest";
import {
  applySessionSegmentPatch,
  createSessionSegment,
} from "./session-segment-merge.js";

describe("session segment revision merge", () => {
  it("accepts a late translation without rolling back newer speaker data", () => {
    const segment = createSessionSegment({
      segmentId: "seg_1",
      turnId: "turn_1",
      revision: 0,
      sourceText: "hello",
      dominantLanguage: "en",
      detectedLanguages: ["en"],
      mixedLanguage: false,
      speaker: speaker("speaker_1"),
      timing: timing(0, 500),
      vadContext: vadContext("max_duration", "a"),
    });
    applySessionSegmentPatch(segment, {
      segmentId: "seg_1",
      turnId: "turn_2",
      revision: 1,
      dominantLanguage: "zh",
      detectedLanguages: ["zh", "en"],
      mixedLanguage: true,
      speaker: speaker("speaker_2"),
      timing: timing(0, 540),
      vadContext: vadContext("silence", "b"),
    });
    applySessionSegmentPatch(segment, {
      segmentId: "seg_1",
      turnId: "turn_1",
      revision: 0,
      sourceText: "stale text",
      dominantLanguage: "en",
      detectedLanguages: ["en"],
      mixedLanguage: false,
      translatedText: "你好",
      targetLanguage: "zh",
      stage: "translation",
      speaker: speaker("speaker_1"),
      timing: timing(0, 500),
      provider: "hymt2_self_hosted",
    });

    expect(segment).toMatchObject({
      turnId: "turn_1",
      revision: 1,
      sourceText: "hello",
      translatedText: "你好",
      targetLanguage: "zh",
      stage: "translation",
      provider: "hymt2_self_hosted",
      speaker: { speakerId: "speaker_2" },
      timing: { startMs: 0, endMs: 540 },
      vadContext: {
        endpointReason: "silence",
        endpointPolicyFingerprint: "b".repeat(64),
      },
      dominantLanguage: "zh",
      detectedLanguages: ["zh", "en"],
      mixedLanguage: true,
    });
  });
});

function speaker(speakerId: string) {
  return {
    speakerId,
    role: "speaker" as const,
    source: "diarization" as const,
  };
}

function timing(startMs: number, endMs: number) {
  return { startMs, endMs, source: "client" as const };
}

function vadContext(endpointReason: "silence" | "max_duration", value: string) {
  return {
    endpointReason,
    endpointPolicyFingerprint: value.repeat(64),
  };
}
