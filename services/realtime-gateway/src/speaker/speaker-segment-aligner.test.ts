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

  it("returns explicit unknown alignment when overlap evidence is weak", () => {
    expect(alignSpeakerSpan(
      { startMs: 1000, endMs: 2000, source: "client" },
      [{ speakerId: "speaker_1", startMs: 900, endMs: 1100 }],
    )).toMatchObject({
      speaker: { speakerId: "unknown", role: "unknown", source: "unknown" },
    });
  });

  it("aligns short speaker evidence inside an ASR padded window", () => {
    expect(alignSpeakerSpan(
      { startMs: 1000, endMs: 11000, source: "client" },
      [{ speakerId: "speaker_2", startMs: 4800, endMs: 5600 }],
    )).toMatchObject({
      speaker: { speakerId: "speaker_2" },
    });
  });

  it("aggregates fragmented evidence for the same speaker", () => {
    expect(alignSpeakerSpan(
      { startMs: 1000, endMs: 2000, source: "client" },
      [
        { speakerId: "speaker_1", startMs: 1000, endMs: 1250 },
        { speakerId: "speaker_1", startMs: 1300, endMs: 1600, overlap: true },
        { speakerId: "speaker_2", startMs: 1600, endMs: 2000 },
      ],
    )).toMatchObject({
      speaker: { speakerId: "speaker_1" },
      timing: {
        overlap: true,
        activeSpeakerIds: ["speaker_1"],
      },
    });
  });

  it("does not double count overlapping spans from one speaker", () => {
    expect(alignSpeakerSpan(
      { startMs: 1000, endMs: 2000, source: "client" },
      [
        { speakerId: "speaker_1", startMs: 1000, endMs: 1400 },
        { speakerId: "speaker_1", startMs: 1200, endMs: 1500 },
      ],
    )).toMatchObject({
      speaker: { speakerId: "speaker_1" },
    });
  });

  it("returns explicit unknown when no speaker dominates the evidence", () => {
    expect(alignSpeakerSpan(
      { startMs: 1000, endMs: 2000, source: "client" },
      [
        { speakerId: "speaker_1", startMs: 1000, endMs: 1400 },
        { speakerId: "speaker_2", startMs: 1600, endMs: 2000 },
      ],
    )).toMatchObject({
      speaker: { speakerId: "unknown", role: "unknown", source: "unknown" },
    });
  });
});
