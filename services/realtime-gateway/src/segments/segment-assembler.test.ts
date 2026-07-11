import { describe, expect, it } from "vitest";
import { SegmentAssembler, shouldHoldForNextSegment } from "./segment-assembler.js";

describe("segment assembler", () => {
  it("holds obvious continuation endings", () => {
    expect(shouldHoldForNextSegment("会议讨论产品计划之后", "zh")).toBe(true);
    expect(shouldHoldForNextSegment("此时的二人在。", "zh")).toBe(true);
    expect(shouldHoldForNextSegment("we need to", "en")).toBe(true);
    expect(shouldHoldForNextSegment("good morning", "en")).toBe(false);
  });

  it("combines an incomplete Chinese segment with its continuation", () => {
    const assembler = new SegmentAssembler();
    const first = assembler.push("sess_1", transcript(
      "asr_1", "今天下午三点我们讨论产品计划之后", "zh", 0.92,
    ), 1000);
    expect(first.ready).toEqual([]);
    expect(first.partial?.segmentId).toBe("asr_1");

    const second = assembler.push("sess_1", transcript(
      "asr_2", "我会整理会议记录发给大家", "zh", 0.88,
    ), 1300);
    expect(second.ready).toEqual([transcript(
      "asr_1",
      "今天下午三点我们讨论产品计划之后我会整理会议记录发给大家",
      "zh",
      0.88,
    )]);
  });

  it("replaces a same-id revision instead of appending it", () => {
    const assembler = new SegmentAssembler();
    assembler.push("sess_1", transcript("asr_1", "we need to", "en"), 1000);
    const result = assembler.push(
      "sess_1",
      transcript("asr_1", "we need to verify the result.", "en"),
      1200,
    );
    expect(result.ready).toEqual([
      transcript("asr_1", "we need to verify the result.", "en"),
    ]);
  });

  it("merges cumulative ASR text without duplicating its prefix", () => {
    const assembler = new SegmentAssembler();
    assembler.push("sess_1", transcript("asr_1", "we need to", "en"), 1000);
    const result = assembler.push(
      "sess_1",
      transcript("asr_2", "we need to verify the result.", "en"),
      1200,
    );
    expect(result.ready[0]).toMatchObject({
      segmentId: "asr_1",
      text: "we need to verify the result.",
    });
  });

  it("drops repeated finals by consumed id or normalized text", () => {
    const assembler = new SegmentAssembler();
    expect(assembler.push(
      "sess_1", transcript("asr_1", "测试完成。", "zh"), 1000,
    ).ready).toHaveLength(1);
    expect(assembler.push(
      "sess_1", transcript("asr_1", "测试完成。", "zh"), 1100,
    ).ready).toEqual([]);
    expect(assembler.push(
      "sess_1", transcript("asr_3", "测试完成", "zh"), 3000,
    ).ready).toHaveLength(1);
    expect(assembler.push(
      "sess_1", transcript("asr_1", "测试完成", "zh"), 5000,
    ).ready).toEqual([]);
    expect(assembler.push(
      "sess_1", transcript("asr_2", "测试完成", "zh"), 1200,
    ).ready).toEqual([]);
  });

  it("forces a pending segment out after the maximum wait", () => {
    const assembler = new SegmentAssembler({ maxBufferMs: 500 });
    assembler.push("sess_1", transcript("asr_1", "this is", "en"), 1000);
    expect(assembler.drainExpired("sess_1", 1499)).toEqual([]);
    expect(assembler.drainExpired("sess_1", 1500)).toEqual([
      transcript("asr_1", "this is", "en"),
    ]);
    expect(assembler.flush("sess_1")).toEqual([]);
  });

  it("releases the previous language before accepting a language switch", () => {
    const assembler = new SegmentAssembler();
    assembler.push("sess_1", transcript("zh_1", "接下来", "zh"), 1000);
    const result = assembler.push(
      "sess_1",
      transcript("en_1", "This is a test.", "en"),
      1200,
    );
    expect(result.ready).toEqual([
      transcript("zh_1", "接下来", "zh"),
      transcript("en_1", "This is a test.", "en"),
    ]);
  });

  it("never merges speech from different speakers", () => {
    const assembler = new SegmentAssembler();
    assembler.push(
      "sess_1",
      attributedTranscript("asr_1", "接下来", "speaker_1"),
      1000,
    );
    const result = assembler.push(
      "sess_1",
      attributedTranscript("asr_2", "我来说明。", "speaker_2"),
      1200,
    );
    expect(result.ready).toEqual([
      attributedTranscript("asr_1", "接下来", "speaker_1"),
      attributedTranscript("asr_2", "我来说明。", "speaker_2"),
    ]);
  });

  it("does not hold an incomplete segment beyond the character limit", () => {
    const assembler = new SegmentAssembler({ maxBufferedCharacters: 4 });
    const result = assembler.push(
      "sess_1",
      transcript("zh_1", "下一步需要", "zh"),
      1000,
    );
    expect(result.ready).toEqual([transcript("zh_1", "下一步需要", "zh")]);
  });

  it("flushes a pending half sentence exactly once", () => {
    const assembler = new SegmentAssembler();
    assembler.push("sess_1", transcript("asr_1", "this is", "en"));
    expect(assembler.flush("sess_1")).toEqual([
      transcript("asr_1", "this is", "en"),
    ]);
    expect(assembler.flush("sess_1")).toEqual([]);
  });

  it("removes inserted punctuation and overlapping words while joining", () => {
    const assembler = new SegmentAssembler();
    assembler.push(
      "sess_1",
      transcript("asr_1", "We need to confirm the translation after the.", "en"),
      1000,
    );
    const result = assembler.push(
      "sess_1",
      transcript("asr_2", "the sentence is complete.", "en"),
      1200,
    );
    expect(result.ready[0]).toMatchObject({
      text: "We need to confirm the translation after the sentence is complete.",
    });
  });
});

function transcript(
  segmentId: string,
  text: string,
  language: "en" | "zh",
  confidence?: number,
) {
  return { segmentId, text, language, ...(confidence === undefined ? {} : { confidence }) };
}

function attributedTranscript(
  segmentId: string,
  text: string,
  speakerId: string,
) {
  return {
    ...transcript(segmentId, text, "zh"),
    speaker: {
      speakerId,
      role: "speaker" as const,
      source: "diarization" as const,
    },
  };
}
