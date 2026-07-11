import { describe, expect, it } from "vitest";
import { evaluateSpeakerDiarization } from "./speaker_eval_metrics.mjs";

describe("speaker diarization metrics", () => {
  it("maps anonymous labels before computing DER", () => {
    const result = evaluateSpeakerDiarization({
      durationMs: 2000,
      frameMs: 100,
      reference: [
        { speakerId: "alice", startMs: 0, endMs: 1000 },
        { speakerId: "bob", startMs: 1000, endMs: 2000 },
      ],
      predicted: [
        { speakerId: "speaker_2", startMs: 0, endMs: 1000 },
        { speakerId: "speaker_1", startMs: 1000, endMs: 2000 },
      ],
    });

    expect(result.mapping).toEqual({ speaker_1: "bob", speaker_2: "alice" });
    expect(result.diarizationErrorRate).toBe(0);
  });

  it("reports miss, false alarm, and speaker confusion separately", () => {
    const result = evaluateSpeakerDiarization({
      durationMs: 3000,
      frameMs: 1000,
      reference: [{ speakerId: "alice", startMs: 0, endMs: 2000 }],
      predicted: [
        { speakerId: "speaker_1", startMs: 0, endMs: 1000 },
        { speakerId: "speaker_2", startMs: 1000, endMs: 3000 },
      ],
    });

    expect(result.diarizationErrorRate).toBe(1);
    expect(result.referenceSpeakerFrames).toBe(2);
  });
});
