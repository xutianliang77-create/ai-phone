import { describe, expect, it } from "vitest";
import { SemanticSegmentAssembler, shouldHoldForNextSegment } from "./semantic-segment-assembler.js";

describe("semantic segment assembler", () => {
  it("holds obvious Chinese continuation endings", () => {
    expect(shouldHoldForNextSegment("会议讨论产品计划之后", "zh")).toBe(true);
    expect(shouldHoldForNextSegment("此时的二人在。", "zh")).toBe(true);
    expect(shouldHoldForNextSegment("就连公司里的那些男艺人也都。", "zh")).toBe(true);
    expect(shouldHoldForNextSegment("这个项目在表面上看，仅仅只。", "zh")).toBe(true);
    expect(shouldHoldForNextSegment("今天我们测试自动翻译", "zh")).toBe(false);
  });

  it("holds obvious English continuation endings", () => {
    expect(shouldHoldForNextSegment("we need to", "en")).toBe(true);
    expect(shouldHoldForNextSegment("we need to confirm the translation after the.", "en")).toBe(true);
    expect(shouldHoldForNextSegment("good morning", "en")).toBe(false);
  });

  it("combines an incomplete Chinese segment with its continuation", () => {
    const assembler = new SemanticSegmentAssembler();

    const first = assembler.push("sess_1", {
      segmentId: "asr_1",
      text: "今天下午三点我们讨论产品计划之后",
      language: "zh",
      confidence: 0.92,
    }, 1000);

    expect(first.ready).toEqual([]);
    expect(first.partial).toMatchObject({
      segmentId: "asr_1",
      text: "今天下午三点我们讨论产品计划之后",
    });

    const second = assembler.push("sess_1", {
      segmentId: "asr_2",
      text: "我会整理会议记录发给大家",
      language: "zh",
      confidence: 0.88,
    }, 1300);

    expect(second.partial).toBeUndefined();
    expect(second.ready).toEqual([{
      segmentId: "asr_1",
      text: "今天下午三点我们讨论产品计划之后我会整理会议记录发给大家",
      language: "zh",
      confidence: 0.88,
    }]);
  });

  it("flushes a pending half sentence when no continuation arrives", () => {
    const assembler = new SemanticSegmentAssembler();
    assembler.push("sess_1", {
      segmentId: "asr_1",
      text: "this is",
      language: "en",
    });

    expect(assembler.flush("sess_1")).toEqual([{
      segmentId: "asr_1",
      text: "this is",
      language: "en",
    }]);
    expect(assembler.flush("sess_1")).toEqual([]);
  });

  it("removes ASR-inserted periods when joining an incomplete English segment", () => {
    const assembler = new SemanticSegmentAssembler();
    assembler.push("sess_1", {
      segmentId: "asr_1",
      text: "We need to confirm the translation after the.",
      language: "en",
    }, 1000);

    const result = assembler.push("sess_1", {
      segmentId: "asr_2",
      text: "sentence is complete.",
      language: "en",
    }, 1200);

    expect(result.ready[0]).toMatchObject({
      segmentId: "asr_1",
      text: "We need to confirm the translation after the sentence is complete.",
      language: "en",
    });
  });

  it("holds ASR-inserted Chinese periods on unfinished locative endings", () => {
    const assembler = new SemanticSegmentAssembler();
    assembler.push("sess_1", {
      segmentId: "asr_1",
      text: "此时的二人在。",
      language: "zh",
    }, 1000);

    const second = assembler.push("sess_1", {
      segmentId: "asr_2",
      text: "海外亮堂会的授意下",
      language: "zh",
    }, 1200);
    expect(second.ready).toEqual([]);

    const result = assembler.push("sess_1", {
      segmentId: "asr_3",
      text: "派出手下的精英骨干",
      language: "zh",
    }, 1400);

    expect(result.ready[0]).toMatchObject({
      segmentId: "asr_1",
      text: "此时的二人在海外亮堂会的授意下派出手下的精英骨干",
      language: "zh",
    });
  });
});
