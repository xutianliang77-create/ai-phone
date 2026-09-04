import { describe, expect, it } from "vitest";
import {
  evaluateSpeakerEndpointNoop,
  type SpeakerEndpointTranscriptEvidence,
} from "./lmstudio-speaker-endpoint-noop.js";

describe("speaker endpoint no-op", () => {
  it("accepts adjacent known finals only after the previous endpoint", () => {
    expect(evaluateSpeakerEndpointNoop(boundary(), [
      transcript("previous", "turn_1", "speaker_1", 0, 5000),
      transcript("next", "turn_2", "speaker_2", 5100, 8000),
    ])).toEqual({
      accepted: true,
      previousSegmentId: "previous",
      nextSegmentId: "next",
      previousGapMs: 100,
      nextGapMs: 0,
    });
  });

  it("rejects any final that crosses the boundary", () => {
    expect(evaluateSpeakerEndpointNoop(boundary(), [
      transcript("previous", "turn_1", "speaker_1", 0, 5000),
      transcript("crossing", "turn_1", "speaker_1", 5000, 5200),
      transcript("next", "turn_2", "speaker_2", 5100, 8000),
    ])).toEqual({ accepted: false, reason: "crossing_parent" });
  });

  it("accepts a VAD timing overrun when all text tokens end before the boundary", () => {
    expect(evaluateSpeakerEndpointNoop(boundary(), [
      {
        ...transcript("previous", "turn_1", "speaker_1", 0, 5320),
        lastTokenEndMs: 5000,
      },
      transcript("next", "turn_2", "speaker_2", 5320, 8000),
    ])).toEqual({
      accepted: true,
      previousSegmentId: "previous",
      nextSegmentId: "next",
      previousGapMs: 100,
      nextGapMs: 220,
    });
  });

  it("rejects unknown or overlap evidence", () => {
    expect(evaluateSpeakerEndpointNoop(boundary(), [
      transcript("previous", "turn_1", "unknown", 0, 5000, true),
      transcript("next", "turn_2", "speaker_2", 5100, 8000),
    ])).toEqual({ accepted: false, reason: "unknown_or_overlap" });
  });

  it("rejects an excessive endpoint gap", () => {
    expect(evaluateSpeakerEndpointNoop(boundary(), [
      transcript("previous", "turn_1", "speaker_1", 0, 3000),
      transcript("next", "turn_2", "speaker_2", 5100, 8000),
    ])).toEqual({ accepted: false, reason: "previous_gap_exceeded" });
  });
});

function boundary() {
  return {
    boundaryMs: 5100,
    previousSpeakerId: "speaker_1",
    nextSpeakerId: "speaker_2",
    previousTurnId: "turn_1",
    nextTurnId: "turn_2",
    confidence: 0.9,
  };
}

function transcript(
  segmentId: string,
  turnId: string,
  speakerId: string,
  startMs: number,
  endMs: number,
  overlap = false,
): SpeakerEndpointTranscriptEvidence {
  return {
    segmentId,
    turnId,
    speakerId,
    speakerKnown: speakerId !== "unknown",
    startMs,
    endMs,
    overlap,
  };
}
