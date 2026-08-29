import { describe, expect, it } from "vitest";
import type { AsrTokenTimingDto } from "@translation/contracts";
import type { TranscriptResult } from "../asr/asr-provider.js";
import type { SpeakerSpan } from "./speaker-attribution-provider.js";
import {
  splitTranscriptAtSpeakerBoundaries,
  type ConfirmedSpeakerBoundary,
} from "./speaker-token-boundary-split.js";

describe("speaker token boundary split", () => {
  it("uses token gaps and Sortformer evidence to split a confirmed turn", () => {
    const result = splitTranscriptAtSpeakerBoundaries(
      transcript(
        "甲方说明乙方回答",
        [
          token("甲方", 0, 2, 0, 300),
          token("说明", 2, 4, 320, 700),
          token("乙方", 4, 6, 800, 1100),
          token("回答", 6, 8, 1120, 1500),
        ],
        1500,
      ),
      [boundary(750, "speaker_1", "speaker_2", "turn_1", "turn_2")],
      [
        span("speaker_1", 0, 750),
        span("speaker_2", 750, 1500),
      ],
      () => true,
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.transcripts).toMatchObject([
      {
        segmentId: "parent_1",
        turnId: "turn_1",
        text: "甲方说明",
        speaker: { speakerId: "speaker_1" },
        timing: { startMs: 0, endMs: 750, source: "model", overlap: false },
        endpointReason: "speaker_boundary",
        tokenTimings: [
          { text: "甲方", characterStart: 0, characterEnd: 2 },
          { text: "说明", characterStart: 2, characterEnd: 4 },
        ],
      },
      {
        segmentId: "parent_1:speaker:1",
        turnId: "turn_2",
        text: "乙方回答",
        speaker: { speakerId: "speaker_2" },
        timing: { startMs: 750, endMs: 1500, source: "model", overlap: false },
        endpointReason: "silence",
        tokenTimings: [
          { text: "乙方", characterStart: 0, characterEnd: 2 },
          { text: "回答", characterStart: 2, characterEnd: 4 },
        ],
      },
    ]);
  });

  it("preserves a returning A-B-A speaker sequence", () => {
    const result = splitTranscriptAtSpeakerBoundaries(
      transcript(
        "甲说乙答甲回",
        [
          token("甲", 0, 1, 0, 200),
          token("说", 1, 2, 210, 400),
          token("乙", 2, 3, 500, 700),
          token("答", 3, 4, 710, 900),
          token("甲", 4, 5, 1000, 1200),
          token("回", 5, 6, 1210, 1400),
        ],
        1500,
      ),
      [
        boundary(450, "speaker_1", "speaker_2", "turn_1", "turn_2"),
        boundary(950, "speaker_2", "speaker_1", "turn_2", "turn_3"),
      ],
      [
        span("speaker_1", 0, 450),
        span("speaker_2", 450, 950),
        span("speaker_1", 950, 1500),
      ],
      () => true,
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.transcripts.map((item) => item.text)).toEqual([
      "甲说",
      "乙答",
      "甲回",
    ]);
    expect(result.transcripts.map((item) => item.speaker?.speakerId)).toEqual([
      "speaker_1",
      "speaker_2",
      "speaker_1",
    ]);
    expect(result.transcripts.map((item) => item.turnId)).toEqual([
      "turn_1",
      "turn_2",
      "turn_3",
    ]);
  });

  it("rejects a cut that would split a Latin identifier", () => {
    const result = splitTranscriptAtSpeakerBoundaries(
      transcript(
        "Qwen3-ASR",
        [
          token("Qwen3", 0, 5, 0, 480),
          token("-", 5, 6, 520, 560),
          token("ASR", 6, 9, 600, 1000),
        ],
        1000,
      ),
      [boundary(500, "speaker_1", "speaker_2", "turn_1", "turn_2")],
      [span("speaker_1", 0, 500), span("speaker_2", 500, 1000)],
      () => true,
    );

    expect(result).toMatchObject({
      accepted: false,
      reason: "protected_surface",
    });
  });

  it("rejects incomplete character offsets and stale text", () => {
    const missingOffsets = transcript(
      "hello world",
      [
        { text: "hello", startMs: 0, endMs: 400 },
        { text: "world", startMs: 500, endMs: 900 },
      ],
      900,
    );
    const result = splitTranscriptAtSpeakerBoundaries(
      missingOffsets,
      [boundary(450, "speaker_1", "speaker_2", "turn_1", "turn_2")],
      [span("speaker_1", 0, 450), span("speaker_2", 450, 900)],
      () => true,
    );

    expect(result).toMatchObject({
      accepted: false,
      reason: "invalid_token_timing",
    });
  });

  it("requires both child windows to agree with Sortformer", () => {
    const result = splitTranscriptAtSpeakerBoundaries(
      transcript(
        "甲方说明乙方回答",
        [
          token("甲方", 0, 2, 0, 300),
          token("说明", 2, 4, 320, 700),
          token("乙方", 4, 6, 800, 1100),
          token("回答", 6, 8, 1120, 1500),
        ],
        1500,
      ),
      [boundary(750, "speaker_1", "speaker_2", "turn_1", "turn_2")],
      [span("speaker_1", 0, 1500)],
      () => true,
    );

    expect(result).toMatchObject({
      accepted: false,
      reason: "sortformer_evidence_mismatch",
    });
  });
});

function transcript(
  text: string,
  tokenTimings: AsrTokenTimingDto[],
  endMs: number,
): TranscriptResult {
  return {
    segmentId: "parent_1",
    revision: 0,
    text,
    language: "zh",
    timing: { startMs: 0, endMs, source: "client" },
    tokenTimings,
    endpointReason: "silence",
  };
}

function token(
  text: string,
  characterStart: number,
  characterEnd: number,
  startMs: number,
  endMs: number,
): AsrTokenTimingDto {
  return { text, characterStart, characterEnd, startMs, endMs };
}

function boundary(
  boundaryMs: number,
  previousSpeakerId: string,
  nextSpeakerId: string,
  previousTurnId: string,
  nextTurnId: string,
): ConfirmedSpeakerBoundary {
  return {
    boundaryMs,
    previousSpeakerId,
    nextSpeakerId,
    previousTurnId,
    nextTurnId,
    confidence: 0.9,
  };
}

function span(
  speakerId: string,
  startMs: number,
  endMs: number,
): SpeakerSpan {
  return {
    speakerId,
    startMs,
    endMs,
    confidence: 0.95,
    final: true,
  };
}
