import { describe, expect, it } from "vitest";

import { SegmentAssembler } from "./segment-assembler.js";
import { MaxDurationContinuationRevisionCoordinator } from
  "./max-duration-continuation-revision.js";
import type { SpeechTranscript } from "./speech-transcript.js";

describe("max-duration continuation revision", () => {
  it("emits immediately, previews the continuation, then revises the first id", () => {
    const assembler = revisionAssembler();
    const first = continuationTranscript({
      segmentId: "qwen3_seg_418",
      revision: 6,
      text: "今天下午三点，我们会讨论产品计划。会议结束以后，我会整。",
      endpointReason: "max_duration",
      startMs: 0,
      endMs: 6000,
    });
    const partial = continuationTranscript({
      segmentId: "qwen3_seg_478",
      revision: 2,
      text: "整理会议纪要",
      isFinal: false,
      startMs: 6001,
      endMs: 9000,
    });
    const final = {
      ...partial,
      revision: 3,
      isFinal: true,
      text: "整理会议纪要，并在下班前发给大家确认。",
      endpointReason: "silence" as const,
      timing: { ...partial.timing!, endMs: 11600 },
    };

    expect(assembler.push("sess_1", first, 1000)).toEqual({ ready: [first] });
    expect(assembler.previewContinuation("sess_1", partial, 4000)).toMatchObject({
      segmentId: "qwen3_seg_418",
      revision: 7,
      text: "今天下午三点，我们会讨论产品计划。会议结束以后，我会整理会议纪要",
    });

    const revised = assembler.push("sess_1", final, 6600);
    expect(revised.supersededSegmentIds).toEqual(["qwen3_seg_478"]);
    expect(revised.ready).toHaveLength(1);
    expect(revised.ready[0]).toMatchObject({
      segmentId: "qwen3_seg_418",
      turnId: "turn_1",
      revision: 7,
      text: "今天下午三点，我们会讨论产品计划。会议结束以后，我会整理会议纪要，并在下班前发给大家确认。",
      endpointReason: "silence",
      speaker: { speakerId: "speaker_1" },
      timing: { startMs: 0, endMs: 11600 },
    });
  });

  it("keeps provisional output when the next final misses the revision window", () => {
    const assembler = revisionAssembler(7500);
    const first = continuationTranscript({
      segmentId: "seg_1", text: "第一段。", endpointReason: "max_duration",
      startMs: 0, endMs: 6000,
    });
    const second = continuationTranscript({
      segmentId: "seg_2", text: "第二段。", endpointReason: "silence",
      startMs: 6001, endMs: 12000,
    });

    expect(assembler.push("sess_1", first, 1000).ready).toEqual([first]);
    expect(assembler.push("sess_1", second, 8501)).toEqual({ ready: [second] });
  });

  it("never rolls the final below a previously emitted continuation preview", () => {
    const assembler = revisionAssembler();
    assembler.push("sess_1", continuationTranscript({
      segmentId: "seg_1", revision: 6, text: "我会整。",
      endpointReason: "max_duration", startMs: 0, endMs: 6000,
    }), 1000);
    const partial = continuationTranscript({
      segmentId: "seg_2", revision: 8, isFinal: false,
      text: "整理会议纪要", startMs: 6001, endMs: 9000,
    });
    expect(assembler.previewContinuation("sess_1", partial, 3000)?.revision)
      .toBe(9);
    const final = continuationTranscript({
      segmentId: "seg_2", revision: 3, text: "整理会议纪要。",
      endpointReason: "silence", startMs: 6001, endMs: 10000,
    });
    expect(assembler.push("sess_1", final, 4000).ready[0].revision).toBe(9);
  });

  it.each([
    ["different speaker", { speakerId: "speaker_2" }],
    ["different turn", { turnId: "turn_2" }],
    ["overlap", { overlap: true }],
    ["multiple active speakers", { activeSpeakerIds: ["speaker_1", "speaker_2"] }],
    ["timing gap", { startMs: 7000 }],
    ["missing turn", { turnId: undefined }],
    ["missing speaker", { speakerId: undefined }],
  ])("does not revise across %s", (_label, change) => {
    const assembler = revisionAssembler();
    const first = continuationTranscript({
      segmentId: "seg_1", text: "我会整。", endpointReason: "max_duration",
      startMs: 0, endMs: 6000,
    });
    const second = continuationTranscript({
      segmentId: "seg_2", text: "整理会议纪要。", endpointReason: "silence",
      startMs: change.startMs ?? 6001,
      endMs: 9000,
      turnId: change.turnId === undefined && "turnId" in change
        ? undefined
        : change.turnId ?? "turn_1",
      speakerId: change.speakerId === undefined && "speakerId" in change
        ? undefined
        : change.speakerId ?? "speaker_1",
      overlap: change.overlap,
      activeSpeakerIds: change.activeSpeakerIds,
    });

    expect(assembler.push("sess_1", first, 1000).ready).toEqual([first]);
    const result = assembler.push("sess_1", second, 3000);
    expect(result.supersededSegmentIds).toBeUndefined();
    expect(result.ready.map((item) => item.segmentId)).toEqual(["seg_2"]);
  });

  it("chains multiple safe max-duration revisions under the first id", () => {
    const assembler = revisionAssembler();
    const first = continuationTranscript({
      segmentId: "seg_1", revision: 2, text: "接下来我会整。",
      endpointReason: "max_duration", startMs: 0, endMs: 6000,
    });
    const second = continuationTranscript({
      segmentId: "seg_2", revision: 1, text: "整理会议纪要并发。",
      endpointReason: "max_duration", startMs: 6001, endMs: 12000,
    });
    const third = continuationTranscript({
      segmentId: "seg_3", revision: 1, text: "发送给大家。",
      endpointReason: "silence", startMs: 12001, endMs: 15000,
    });

    assembler.push("sess_1", first, 1000);
    const twice = assembler.push("sess_1", second, 3000);
    expect(twice.ready[0]).toMatchObject({
      segmentId: "seg_1", revision: 3, text: "接下来我会整理会议纪要并发。",
    });
    expect(twice.supersededSegmentIds).toEqual(["seg_2"]);
    const thrice = assembler.push("sess_1", third, 5000);
    expect(thrice.ready[0]).toMatchObject({
      segmentId: "seg_1", revision: 4, text: "接下来我会整理会议纪要并发送给大家。",
    });
    expect(thrice.supersededSegmentIds).toEqual(["seg_3"]);
  });

  it.each([
    ["ASCII", "使用 A。", "ASR 模型。", "使用 A ASR 模型。"],
    ["Arabic digit", "金额 3。", "31.5 美元。", "金额 3 31.5 美元。"],
    ["Chinese digit", "金额三。", "三十一元。", "金额三三十一元。"],
  ])("does not delete protected one-character %s overlap", (_label, left, right, expected) => {
    const assembler = revisionAssembler();
    assembler.push("sess_1", continuationTranscript({
      segmentId: "seg_1", text: left, endpointReason: "max_duration",
      startMs: 0, endMs: 6000,
    }), 1000);
    const result = assembler.push("sess_1", continuationTranscript({
      segmentId: "seg_2", text: right, endpointReason: "silence",
      startMs: 6001, endMs: 9000,
    }), 3000);
    expect(result.ready[0].text).toBe(expected);
  });

  it("does not duplicate or drop an emitted provisional during flush", () => {
    const assembler = revisionAssembler();
    const first = continuationTranscript({
      segmentId: "seg_1", text: "最后一句。", endpointReason: "max_duration",
      startMs: 0, endMs: 6000,
    });
    expect(assembler.push("sess_1", first, 1000).ready).toEqual([first]);
    expect(assembler.flush("sess_1", 2000)).toEqual([]);
    expect(assembler.flush("sess_1", 3000)).toEqual([]);
  });

  it("ends provisional continuation state after a speaker-boundary revision", () => {
    const coordinator = new MaxDurationContinuationRevisionCoordinator({
      enabled: true,
      maxWindowMs: 7500,
    });
    const first = continuationTranscript({
      segmentId: "seg_1", revision: 6, text: "前一位我觉得咱这个这个。",
      endpointReason: "max_duration", startMs: 0, endMs: 6459,
    });
    const corrected = continuationTranscript({
      segmentId: "seg_1", revision: 7, text: "前一位。",
      endpointReason: "speaker_boundary", startMs: 0, endMs: 6000,
    });

    expect(coordinator.push("sess_1", first, 1000).handled).toBe(true);
    expect(coordinator.push("sess_1", corrected, 2000)).toMatchObject({
      handled: true,
      transcript: corrected,
    });
    expect(coordinator.push("sess_1", {
      ...corrected,
      revision: 6,
    }, 2100)).toEqual({ handled: false });
  });
});

function revisionAssembler(maxContinuationBufferMs = 7500) {
  return new SegmentAssembler({
    emitMaxDurationRevisions: true,
    maxContinuationBufferMs,
  });
}

function continuationTranscript(input: {
  segmentId: string;
  text: string;
  endpointReason?: "max_duration" | "silence" | "speaker_boundary";
  revision?: number;
  isFinal?: boolean;
  turnId?: string;
  speakerId?: string;
  startMs: number;
  endMs: number;
  overlap?: boolean;
  activeSpeakerIds?: string[];
}): SpeechTranscript & { isFinal?: boolean } {
  const turnId = "turnId" in input ? input.turnId : "turn_1";
  const speakerId = "speakerId" in input ? input.speakerId : "speaker_1";
  return {
    segmentId: input.segmentId,
    text: input.text,
    language: "zh",
    ...(input.endpointReason ? { endpointReason: input.endpointReason } : {}),
    ...(input.revision === undefined ? {} : { revision: input.revision }),
    ...(input.isFinal === undefined ? {} : { isFinal: input.isFinal }),
    ...(turnId ? { turnId } : {}),
    ...(speakerId ? {
      speaker: {
        speakerId,
        role: "speaker",
        source: "diarization",
      },
    } : {}),
    timing: {
      startMs: input.startMs,
      endMs: input.endMs,
      source: "client",
      ...(input.overlap === undefined ? {} : { overlap: input.overlap }),
      ...(input.activeSpeakerIds ? { activeSpeakerIds: input.activeSpeakerIds } : {}),
    },
  };
}
