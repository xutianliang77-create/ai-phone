import { describe, expect, it } from "vitest";
import { isSpeechPipelineTiming } from "./diagnostics.js";

describe("speech pipeline timing", () => {
  it("accepts a bounded stage timeline", () => {
    expect(isSpeechPipelineTiming({
      asrStartedAtMs: 100,
      asrFinalAtMs: 220,
      turnBufferReleasedAtMs: 240,
      translationFinalAtMs: 300,
      eventPublishStartedAtMs: 310,
    })).toBe(true);
  });

  it("rejects negative and unknown timing fields", () => {
    expect(isSpeechPipelineTiming({ asrStartedAtMs: -1 })).toBe(false);
    expect(isSpeechPipelineTiming({
      asrStartedAtMs: 100,
      transcriptText: "must not be persisted",
    })).toBe(false);
  });
});
