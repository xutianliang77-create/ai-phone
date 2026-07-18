import { describe, expect, it } from "vitest";
import { isSpeechPipelineTiming } from "./diagnostics.js";

describe("speech pipeline timing", () => {
  it("accepts a bounded stage timeline", () => {
    expect(isSpeechPipelineTiming({
      asrStartedAtMs: 100,
      asrFinalAtMs: 220,
      turnBufferReleasedAtMs: 240,
      translationStartedAtMs: 250,
      translationFirstTokenAtMs: 270,
      translationFinalAtMs: 300,
      ttsStartedAtMs: 310,
      ttsFirstAudioAtMs: 340,
      ttsReadyAtMs: 400,
      eventPublishStartedAtMs: 310,
    })).toBe(true);
  });

  it("rejects negative and unknown timing fields", () => {
    expect(isSpeechPipelineTiming({ asrStartedAtMs: -1 })).toBe(false);
    expect(isSpeechPipelineTiming({
      translationStartedAtMs: 300,
      translationFirstTokenAtMs: 299,
    })).toBe(false);
    expect(isSpeechPipelineTiming({
      translationStartedAtMs: 300,
      translationFinalAtMs: 299,
    })).toBe(false);
    expect(isSpeechPipelineTiming({
      ttsFirstAudioAtMs: 400,
      ttsReadyAtMs: 399,
    })).toBe(false);
    expect(isSpeechPipelineTiming({
      asrStartedAtMs: 100,
      transcriptText: "must not be persisted",
    })).toBe(false);
  });
});
