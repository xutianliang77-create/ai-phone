import { describe, expect, it } from "vitest";
import {
  applySessionSegmentPatch,
  createSessionSegment,
  mergeSessionSegments,
} from "./session-segment-merge.js";

describe("session segment revision merge", () => {
  it("rejects a late translation from an older transcript revision", () => {
    const segment = createSessionSegment({
      segmentId: "seg_1",
      turnId: "turn_1",
      revision: 0,
      sourceText: "hello",
      translatedText: "旧译文",
      targetLanguage: "zh",
      stage: "translation",
      provider: "old_provider",
      pipelineTiming: {
        translationStartedAtMs: 50,
        translationFinalAtMs: 80,
      },
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
      turnId: "turn_2",
      revision: 1,
      sourceText: "hello",
      translatedText: "",
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
    expect(segment).not.toHaveProperty("provider");
    expect(segment).not.toHaveProperty("targetLanguage");
    expect(segment).not.toHaveProperty("pipelineTiming");
  });

  it("merges progressive timing for the current pipeline generation", () => {
    const segment = createSessionSegment({
      segmentId: "seg_1",
      speechId: "speech_1",
      turnId: "turn_1",
      revision: 1,
      pipelineGeneration: 2,
      sourceText: "call fifty",
      pipelineTiming: {
        asrStartedAtMs: 100,
        asrFinalAtMs: 220,
      },
    });

    applySessionSegmentPatch(segment, {
      segmentId: "seg_1",
      speechId: "speech_1",
      turnId: "turn_1",
      revision: 1,
      pipelineGeneration: 2,
      translatedText: "拨打五十",
      targetLanguage: "zh",
      stage: "translation",
      provider: "hymt2_self_hosted",
      pipelineTiming: {
        translationStartedAtMs: 230,
        translationFinalAtMs: 280,
      },
    });
    applySessionSegmentPatch(segment, {
      segmentId: "seg_1",
      speechId: "speech_1",
      turnId: "turn_1",
      revision: 1,
      pipelineGeneration: 1,
      translatedText: "过期结果",
      targetLanguage: "zh",
      stage: "translation",
      provider: "stale_provider",
      pipelineTiming: { translationFinalAtMs: 999 },
    });

    expect(segment).toMatchObject({
      speechId: "speech_1",
      turnId: "turn_1",
      revision: 1,
      pipelineGeneration: 2,
      translatedText: "拨打五十",
      provider: "hymt2_self_hosted",
      pipelineTiming: {
        asrStartedAtMs: 100,
        asrFinalAtMs: 220,
        translationStartedAtMs: 230,
        translationFinalAtMs: 280,
      },
    });
  });

  it("clears derived translation when refinement advances the generation", () => {
    const segment = createSessionSegment({
      segmentId: "seg_1",
      speechId: "speech_1",
      turnId: "turn_1",
      revision: 0,
      pipelineGeneration: 1,
      sourceText: "call fifteen",
      translatedText: "拨打十五",
      targetLanguage: "zh",
      stage: "translation",
      provider: "old_provider",
      pipelineTiming: { translationFinalAtMs: 80 },
    });

    applySessionSegmentPatch(segment, {
      segmentId: "seg_1",
      speechId: "speech_1",
      turnId: "turn_1",
      revision: 0,
      pipelineGeneration: 2,
      sourceText: "call fifty",
      rawText: "call fifteen",
      optimizedText: "call fifty",
    });

    expect(segment).toMatchObject({
      revision: 0,
      pipelineGeneration: 2,
      sourceText: "call fifty",
      rawText: "call fifteen",
      optimizedText: "call fifty",
      translatedText: "",
    });
    expect(segment.provider).toBeUndefined();
    expect(segment.targetLanguage).toBeUndefined();
    expect(segment.pipelineTiming).toBeUndefined();
  });

  it("does not retain derived translation when a full newer revision is saved", () => {
    const [segment] = mergeSessionSegments([{
      id: "seg_1",
      speechId: "speech_1",
      turnId: "turn_1",
      revision: 0,
      pipelineGeneration: 1,
      sourceText: "call fifteen",
      translatedText: "拨打十五",
      targetLanguage: "zh",
      stage: "translation",
      provider: "old_provider",
    }], [{
      id: "seg_1",
      speechId: "speech_1",
      turnId: "turn_1",
      revision: 1,
      pipelineGeneration: 2,
      sourceText: "call fifty",
      translatedText: "",
    }]);

    expect(segment).toMatchObject({
      revision: 1,
      pipelineGeneration: 2,
      sourceText: "call fifty",
      translatedText: "",
    });
    expect(segment.provider).toBeUndefined();
    expect(segment.targetLanguage).toBeUndefined();
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
