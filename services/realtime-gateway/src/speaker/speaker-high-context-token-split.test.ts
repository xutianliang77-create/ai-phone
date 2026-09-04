import { describe, expect, it } from "vitest";
import type { AsrTokenTimingDto } from "@translation/contracts";
import type {
  SpeakerRevisionResult,
} from "./speaker-revision-provider.js";
import {
  planHighContextTokenSplits,
  type StoredTranscriptFinal,
} from "./speaker-high-context-token-split.js";

describe("high-context Sortformer token split", () => {
  it("turns a crossing parent into cardinality-safe translated children", () => {
    const plan = planHighContextTokenSplits(revision(), segments());

    expect(plan.accepted).toBe(true);
    if (!plan.accepted) return;
    expect(plan.parentSegmentIds).toEqual(["seg_1"]);
    expect(plan.transcripts).toHaveLength(2);
    expect(plan.transcripts).toMatchObject([
      {
        segmentId: "seg_1",
        text: "甲乙丙丁戊己",
        revision: 4,
        speaker: { speakerId: "speaker_1" },
        timing: { startMs: 1_000, endMs: 1_600 },
      },
      {
        segmentId: "seg_1:speaker:1",
        text: "庚辛",
        revision: 4,
        speaker: { speakerId: "speaker_2" },
        timing: { startMs: 1_600, endMs: 1_800 },
      },
    ]);
    expect(plan.transcripts.flatMap((item) => item.tokenTimings ?? []))
      .toHaveLength(8);
  });

  it("uses raw text timing after display-text refinement", () => {
    const refined = segments();
    refined[0] = {
      ...refined[0],
      text: "甲乙丙丁戊己庚",
      rawText: "甲乙丙丁戊己庚辛",
      tokenTimings: undefined,
      rawTokenTimings: tokens("甲乙丙丁戊己庚辛", 1_000),
    };

    const plan = planHighContextTokenSplits(revision(), refined);

    expect(plan.accepted).toBe(true);
    if (!plan.accepted) return;
    expect(plan.transcripts.map((item) => item.text)).toEqual([
      "甲乙丙丁戊己",
      "庚辛",
    ]);
  });

  it("rejects a high-context cardinality change", () => {
    const changed = revision();
    changed.speakerCount = 3;
    changed.spans.push({
      speakerId: "S03",
      startMs: 600,
      endMs: 800,
      confidence: 0.9,
    });

    expect(planHighContextTokenSplits(changed, segments())).toMatchObject({
      accepted: false,
      reason: "cardinality_mismatch",
    });
  });

  it("keeps explicit overlap segments locked", () => {
    const locked = segments();
    locked[0] = {
      ...locked[0],
      timing: { ...locked[0].timing!, overlap: true },
    };

    expect(planHighContextTokenSplits(revision(), locked)).toMatchObject({
      accepted: false,
      reason: "no_crossing_transcript",
    });
  });

  it("rejects a boundary without strong high-context confidence", () => {
    const weak = revision();
    weak.spans[1].confidence = 0.59;

    expect(planHighContextTokenSplits(weak, segments())).toMatchObject({
      accepted: false,
      reason: "token_split_unconfirmed_boundary",
    });
  });

  it("rejects stale character timing instead of slicing by ratio", () => {
    const stale = segments();
    stale[0] = {
      ...stale[0],
      tokenTimings: undefined,
      rawTokenTimings: undefined,
    };

    expect(planHighContextTokenSplits(revision(), stale)).toMatchObject({
      accepted: false,
      reason: "token_split_missing_token_timing",
    });
  });

  it("keeps safe parent splits when another crossing parent has no safe token boundary", () => {
    const mixed = segments();
    mixed[0] = {
      ...mixed[0],
      tokenTimings: undefined,
      rawTokenTimings: tokens("甲乙丙丁戊己庚辛", 1_000).map((item) => ({
        ...item,
        startMs: 1_000 + Math.round((item.startMs - 1_000) * 0.4),
        endMs: 1_000 + Math.round((item.endMs - 1_000) * 0.4),
      })),
    };
    mixed[1] = {
      ...mixed[1],
      tokenTimings: [
        {
          text: "戊",
          startMs: 1_800,
          endMs: 2_300,
          characterStart: 0,
          characterEnd: 1,
        },
        {
          text: "己",
          startMs: 2_500,
          endMs: 2_900,
          characterStart: 1,
          characterEnd: 2,
        },
      ],
    };
    const returning = revision();
    returning.spans = [
      { speakerId: "S01", startMs: 0, endMs: 600, confidence: 0.9 },
      { speakerId: "S02", startMs: 600, endMs: 1_400, confidence: 0.9 },
      { speakerId: "S01", startMs: 1_400, endMs: 2_000, confidence: 0.9 },
    ];

    const plan = planHighContextTokenSplits(returning, mixed);

    expect(plan).toMatchObject({
      accepted: true,
      parentSegmentIds: ["seg_2"],
      skippedParents: [{
        segmentId: "seg_1",
        reason: "no_safe_token_boundary",
      }],
    });
    if (!plan.accepted) return;
    expect(plan.transcripts.map((item) => item.segmentId)).toEqual([
      "seg_2",
      "seg_2:speaker:1",
    ]);
  });

  it("accepts a speaker change across the listening silence window", () => {
    const pausedRevision = revision();
    pausedRevision.spans[1] = {
      ...pausedRevision.spans[1],
      startMs: 1_400,
    };
    const pausedSegments = segments();
    pausedSegments[0] = {
      ...pausedSegments[0],
      timing: { startMs: 1_000, endMs: 2_600, source: "model" },
      tokenTimings: [
        ...tokens("甲乙丙丁戊己", 1_000),
        ...tokens("庚辛", 2_400).map((item) => ({
          ...item,
          characterStart: item.characterStart! + 6,
          characterEnd: item.characterEnd! + 6,
        })),
      ],
    };
    pausedSegments[1] = {
      ...pausedSegments[1],
      timing: { startMs: 2_400, endMs: 3_000, source: "model" },
    };

    expect(planHighContextTokenSplits(pausedRevision, pausedSegments))
      .toMatchObject({
        accepted: true,
        transcripts: [
          { speaker: { speakerId: "speaker_1" } },
          { speaker: { speakerId: "speaker_2" } },
        ],
      });
  });
});

function revision(): SpeakerRevisionResult {
  return {
    sessionId: "sess_1",
    generation: 1,
    windowStartMs: 1_000,
    windowEndMs: 3_000,
    provider: "sortformer_high_context",
    model: "diar_streaming_sortformer_4spk-v2.1",
    speakerCount: 2,
    spans: [
      {
        speakerId: "S01",
        startMs: 0,
        endMs: 600,
        confidence: 0.9,
      },
      {
        speakerId: "S02",
        startMs: 600,
        endMs: 2_000,
        confidence: 0.9,
      },
    ],
  };
}

function segments(): StoredTranscriptFinal[] {
  return [
    {
      type: "transcript.final",
      sessionId: "sess_1",
      segmentId: "seg_1",
      turnId: "turn_1",
      revision: 3,
      text: "甲乙丙丁戊己庚辛",
      language: "zh",
      speaker: diarized("speaker_1"),
      timing: { startMs: 1_000, endMs: 1_800, source: "model" },
      tokenTimings: tokens("甲乙丙丁戊己庚辛", 1_000),
    },
    {
      type: "transcript.final",
      sessionId: "sess_1",
      segmentId: "seg_2",
      turnId: "turn_2",
      revision: 2,
      text: "戊己",
      language: "zh",
      speaker: diarized("speaker_2"),
      timing: { startMs: 1_800, endMs: 3_000, source: "model" },
      tokenTimings: tokens("壬癸", 1_800),
    },
  ];
}

function tokens(text: string, startMs: number): AsrTokenTimingDto[] {
  return Array.from(text).map((value, index) => ({
    text: value,
    startMs: startMs + index * 100,
    endMs: startMs + (index + 1) * 100,
    characterStart: index,
    characterEnd: index + 1,
  }));
}

function diarized(speakerId: string) {
  return {
    speakerId,
    role: "speaker" as const,
    source: "diarization" as const,
  };
}
