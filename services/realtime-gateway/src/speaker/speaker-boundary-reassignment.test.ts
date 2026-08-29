import { describe, expect, it } from "vitest";

import { planSpeakerBoundaryReassignment } from
  "./speaker-boundary-reassignment.js";

describe("speaker boundary reassignment", () => {
  it("moves an acoustically confirmed suffix to the next speaker", () => {
    const plan = planSpeakerBoundaryReassignment({
      previous: transcript({
        segmentId: "seg_a",
        turnId: "turn_1",
        revision: 6,
        speakerId: "speaker_1",
        text: "首先谈大家伙儿的一个看法。那我觉得咱这个这个。",
        startMs: 32000,
        endMs: 50741,
      }),
      witness: transcript({
        segmentId: "boundary_witness",
        turnId: "turn_2",
        speakerId: "speaker_3",
        text: "我觉得咱们这个这个目标人群可以不",
        startMs: 50122,
        endMs: 52682,
      }),
      next: transcript({
        segmentId: "seg_b",
        turnId: "turn_2",
        revision: 7,
        speakerId: "speaker_3",
        text: "人群可以不不用定的那么确定。",
        startMs: 51343,
        endMs: 69540,
      }),
      boundary: boundary(),
    });

    expect(plan).not.toBeNull();
    expect(plan?.previous).toMatchObject({
      segmentId: "seg_a",
      turnId: "turn_1",
      revision: 7,
      text: "首先谈大家伙儿的一个看法。那。",
      speaker: { speakerId: "speaker_1" },
      timing: { endMs: 50282 },
      endpointReason: "speaker_boundary",
    });
    expect(plan?.next).toMatchObject({
      segmentId: "seg_b",
      turnId: "turn_2",
      revision: 8,
      text: "我觉得咱们这个这个目标人群可以不不用定的那么确定。",
      speaker: { speakerId: "speaker_3" },
      timing: { startMs: 50282, endMs: 69540 },
    });
    expect(plan?.movedText).toBe("我觉得咱这个这个");
  });

  it.each([
    ["previous speaker mismatch", { previousSpeaker: "speaker_2" }],
    ["next speaker mismatch", { nextSpeaker: "speaker_4" }],
    ["turn mismatch", { nextTurn: "turn_3" }],
    ["overlap", { overlap: true }],
    ["multiple active speakers", {
      activeSpeakerIds: ["speaker_1", "speaker_3"],
    }],
    ["overrun too large", { previousEndMs: 52000 }],
    ["no timing cross", { previousEndMs: 50282 }],
    ["weak acoustic match", { witnessText: "完全不相关的开头内容" }],
    ["no witness-to-next overlap", { nextText: "另一段完全不同的内容。" }],
    ["unbounded witness growth", {
      witnessText:
        "我觉得咱们这个这个这里出现了完全没有声学依据的大段新增内容人群可以不",
    }],
  ])("fails closed on %s", (_label, change) => {
    const plan = planSpeakerBoundaryReassignment({
      previous: transcript({
        segmentId: "seg_a",
        turnId: "turn_1",
        speakerId: change.previousSpeaker ?? "speaker_1",
        text: "大家的看法。那我觉得咱这个这个。",
        startMs: 32000,
        endMs: change.previousEndMs ?? 50741,
        overlap: change.overlap,
        activeSpeakerIds: change.activeSpeakerIds,
      }),
      witness: transcript({
        segmentId: "witness",
        turnId: "turn_2",
        speakerId: "speaker_3",
        text: change.witnessText ?? "我觉得咱们这个这个目标人群可以不",
        startMs: 50282,
        endMs: 52682,
      }),
      next: transcript({
        segmentId: "seg_b",
        turnId: change.nextTurn ?? "turn_2",
        speakerId: change.nextSpeaker ?? "speaker_3",
        text: change.nextText ?? "人群可以不不用定的那么确定。",
        startMs: 51343,
        endMs: 69540,
      }),
      boundary: boundary(),
    });

    expect(plan).toBeNull();
  });

  it.each([
    ["Chinese numeric", "他说十八到五十。", "他说十八到十五岁", "十八到十五岁。"],
    ["Latin entity", "请使用 Qwen3。", "请使用 Qwen2 模型", "Qwen2 模型。"],
  ])("does not fuzzily move protected %s text", (_label, left, witness, next) => {
    const plan = planSpeakerBoundaryReassignment({
      previous: transcript({
        segmentId: "seg_a", turnId: "turn_1", speakerId: "speaker_1",
        text: left, startMs: 49000, endMs: 50741,
      }),
      witness: transcript({
        segmentId: "witness", turnId: "turn_2", speakerId: "speaker_3",
        text: witness, startMs: 50282, endMs: 52682,
      }),
      next: transcript({
        segmentId: "seg_b", turnId: "turn_2", speakerId: "speaker_3",
        text: next, startMs: 51343, endMs: 69540,
      }),
      boundary: boundary(),
    });

    expect(plan).toBeNull();
  });
});

function boundary() {
  return {
    previousSpeakerId: "speaker_1",
    nextSpeakerId: "speaker_3",
    boundaryMs: 50282,
    confirmedAtMs: 51242,
    confidence: 0.77,
    dominanceRatio: 1,
  };
}

function transcript(input: {
  segmentId: string;
  turnId: string;
  revision?: number;
  speakerId: string;
  text: string;
  startMs: number;
  endMs: number;
  overlap?: boolean;
  activeSpeakerIds?: string[];
}) {
  return {
    segmentId: input.segmentId,
    turnId: input.turnId,
    revision: input.revision ?? 0,
    text: input.text,
    language: "zh" as const,
    endpointReason: "max_duration" as const,
    speaker: {
      speakerId: input.speakerId,
      role: "speaker" as const,
      source: "diarization" as const,
    },
    timing: {
      startMs: input.startMs,
      endMs: input.endMs,
      source: "client" as const,
      ...(input.overlap === undefined ? {} : { overlap: input.overlap }),
      ...(input.activeSpeakerIds
        ? { activeSpeakerIds: input.activeSpeakerIds }
        : {}),
    },
  };
}
