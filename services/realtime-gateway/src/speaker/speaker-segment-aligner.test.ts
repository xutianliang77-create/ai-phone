import { describe, expect, it } from "vitest";
import { alignSpeakerSpan } from "./speaker-segment-aligner.js";

describe("speaker segment aligner", () => {
  it("selects the speaker with the largest time overlap", () => {
    expect(alignSpeakerSpan(
      { startMs: 1000, endMs: 2000, source: "client" },
      [
        { speakerId: "speaker_1", startMs: 900, endMs: 1250 },
        {
          speakerId: "speaker_2",
          startMs: 1200,
          endMs: 2100,
          confidence: 0.92,
        },
      ],
    )).toEqual({
      speaker: {
        speakerId: "speaker_2",
        role: "speaker",
        source: "diarization",
        confidence: 0.92,
      },
      timing: { startMs: 1000, endMs: 2000, source: "client" },
    });
  });

  it("returns unknown alignment when overlap evidence is weak", () => {
    expect(alignSpeakerSpan(
      { startMs: 1000, endMs: 2000, source: "client" },
      [{ speakerId: "speaker_1", startMs: 900, endMs: 1100 }],
    )).toBeNull();
  });
});
