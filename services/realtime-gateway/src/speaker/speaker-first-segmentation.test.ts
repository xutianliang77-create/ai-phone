import type { AsrTokenTimingDto } from "@translation/contracts";
import { describe, expect, it } from "vitest";
import {
  planSpeakerFirstSegmentation,
} from "./speaker-first-segmentation.js";
import type {
  StoredTranscriptFinal,
} from "./speaker-high-context-token-split.js";
import type { SpeakerRevisionResult } from "./speaker-revision-provider.js";

describe("speaker-first segmentation", () => {
  it("converges a three-slot A-B-A session to two speakers before splitting", () => {
    const plan = planSpeakerFirstSegmentation(revision(), segments());

    if (!plan.accepted) throw new Error(plan.reason);
    expect(plan).toMatchObject({ accepted: true });
    expect(plan.parentSegmentIds).toEqual(["seg_1", "seg_4"]);
    expect(plan.transcripts.map((item) => item.speaker?.speakerId)).toEqual([
      "speaker_1",
      "speaker_2",
      "speaker_2",
      "speaker_1",
    ]);
    expect(plan.speakerUpdates.map((item) => [
      item.segmentId,
      item.speaker.speakerId,
    ])).toEqual([
      ["seg_2", "speaker_2"],
      ["seg_3", "speaker_2"],
      ["seg_5", "speaker_1"],
    ]);
    expect(plan.transcripts.filter((item) => item.segmentId.startsWith("seg_1"))
      .map((item) => item.text).join(""))
      .toBe("甲乙丙丁戊己庚辛");
    expect(plan.transcripts.filter((item) => item.segmentId.startsWith("seg_4"))
      .map((item) => item.text).join(""))
      .toBe("午未申酉戌亥天地");
  });

  it("rejects collapsing an existing multi-speaker session to one", () => {
    expect(planSpeakerFirstSegmentation({
      ...revision(),
      speakerCount: 1,
      spans: [{ speakerId: "S01", startMs: 0, endMs: 3_000 }],
    }, segments())).toMatchObject({
      accepted: false,
      reason: "single_speaker_collapse",
    });
  });

  it("rejects high-context speaker-count growth", () => {
    expect(planSpeakerFirstSegmentation({
      ...revision(),
      speakerCount: 4,
      spans: [
        { speakerId: "S01", startMs: 0, endMs: 600 },
        { speakerId: "S02", startMs: 600, endMs: 1_200 },
        { speakerId: "S03", startMs: 1_200, endMs: 1_800 },
        { speakerId: "S04", startMs: 1_800, endMs: 3_000 },
      ],
    }, segments())).toMatchObject({
      accepted: false,
      reason: "speaker_count_growth",
    });
  });

  it("keeps safe speaker-only updates when token splitting is unavailable", () => {
    const withoutTiming = segments().map((segment) => ({
      ...segment,
      rawTokenTimings: undefined,
    }));

    const plan = planSpeakerFirstSegmentation(revision(), withoutTiming);

    expect(plan).toMatchObject({
      accepted: true,
      transcripts: [],
      skippedParents: [
        { segmentId: "seg_1", reason: "missing_token_timing" },
        { segmentId: "seg_4", reason: "missing_token_timing" },
      ],
    });
    if (!plan.accepted) return;
    expect(plan.speakerUpdates.map((item) => item.segmentId)).toEqual([
      "seg_1",
      "seg_2",
      "seg_3",
      "seg_4",
      "seg_5",
    ]);
  });

  it("demotes a residual raw slot without high-context support", () => {
    const plan = planSpeakerFirstSegmentation(revisionWithGap(), [
      segment("gap_1", "speaker_1", 0, 1_000, "甲乙丙丁"),
      segment("gap_2", "speaker_3", 1_200, 1_500, "戊己"),
      segment("gap_3", "speaker_2", 1_500, 2_200, "庚辛壬癸"),
      segment("gap_slot", "speaker_3", 2_250, 2_500, "子丑"),
      segment("gap_5", "speaker_1", 2_600, 4_000, "寅卯辰巳"),
    ]);

    if (!plan.accepted) throw new Error(plan.reason);
    expect(plan.speakerIdMapping).toMatchObject({
      speaker_1: "speaker_1",
      speaker_2: "speaker_2",
      speaker_3: "unknown",
    });
    expect(plan.speakerUpdates.map((item) => [
      item.segmentId,
      item.speaker.speakerId,
    ])).toContainEqual(["gap_slot", "unknown"]);
  });
});

function revision(): SpeakerRevisionResult {
  return {
    sessionId: "sess_1",
    generation: 1,
    windowStartMs: 0,
    windowEndMs: 3_000,
    provider: "sortformer_high_context",
    speakerCount: 2,
    spans: [
      { speakerId: "S01", startMs: 0, endMs: 600, confidence: 0.95 },
      { speakerId: "S02", startMs: 600, endMs: 2_000, confidence: 0.92 },
      { speakerId: "S01", startMs: 2_000, endMs: 3_000, confidence: 0.94 },
    ],
  };
}

function revisionWithGap(): SpeakerRevisionResult {
  return {
    sessionId: "sess_1",
    generation: 1,
    windowStartMs: 0,
    windowEndMs: 4_000,
    provider: "sortformer_high_context",
    speakerCount: 2,
    spans: [
      { speakerId: "S01", startMs: 0, endMs: 1_000, confidence: 0.95 },
      { speakerId: "S02", startMs: 1_200, endMs: 2_200, confidence: 0.92 },
      { speakerId: "S01", startMs: 2_600, endMs: 4_000, confidence: 0.94 },
    ],
  };
}

function segments(): StoredTranscriptFinal[] {
  return [
    segment("seg_1", "speaker_1", 0, 800, "甲乙丙丁戊己庚辛"),
    segment("seg_2", "speaker_3", 800, 1_400, "壬癸子丑寅卯"),
    segment("seg_3", "speaker_1", 1_400, 1_800, "辰巳午未"),
    segment("seg_4", "speaker_2", 1_800, 2_600, "午未申酉戌亥天地"),
    segment("seg_5", "speaker_2", 2_600, 3_000, "玄黄宇宙"),
  ];
}

function segment(
  segmentId: string,
  speakerId: string,
  startMs: number,
  endMs: number,
  text: string,
): StoredTranscriptFinal {
  return {
    type: "transcript.final",
    sessionId: "sess_1",
    segmentId,
    turnId: `turn_${segmentId}`,
    revision: 2,
    text,
    rawText: text,
    language: "zh",
    speaker: { speakerId, role: "speaker", source: "diarization" },
    timing: { startMs, endMs, source: "model" },
    rawTokenTimings: tokenTimings(text, startMs, endMs),
  };
}

function tokenTimings(
  text: string,
  startMs: number,
  endMs: number,
): AsrTokenTimingDto[] {
  const duration = endMs - startMs;
  return Array.from(text).map((value, index) => ({
    text: value,
    startMs: startMs + Math.round(duration * index / text.length),
    endMs: startMs + Math.round(duration * (index + 1) / text.length),
    characterStart: index,
    characterEnd: index + 1,
  }));
}
