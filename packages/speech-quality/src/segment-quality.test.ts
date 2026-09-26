import { describe, expect, it } from "vitest";
import { SegmentAssembler } from "./segment-assembler.js";

describe("shared speech quality", () => {
  it("holds a missing predicate, but not a complete short answer, without changing the flush limit",()=>{
    const assembler=new SegmentAssembler({maxBufferMs:1800});
    expect(assembler.push("s",{segmentId:"first",language:"zh",text:"刚好把我们。",endpointReason:"silence"},0).ready).toEqual([]);
    expect(assembler.push("s",{segmentId:"second",language:"zh",text:"送到会场。",endpointReason:"silence"},500).ready[0].text).toBe("刚好把我们送到会场。");
    expect(assembler.push("other",{segmentId:"answer",language:"en",text:"Okay.",endpointReason:"silence"},0).ready[0].text).toBe("Okay.");
    assembler.push("tail",{segmentId:"unfinished",language:"zh",text:"我会将它。",endpointReason:"silence"},0);
    expect(assembler.flush("tail")[0].text).toBe("我会将它。");
  });
  it("merges a raw max-duration segment with its continuation", () => {
    const assembler = new SegmentAssembler();
    expect(assembler.push("session", {
      segmentId: "first",
      text: "今天讨论产品计划，",
      language: "zh",
      endpointReason: "max_duration",
      pipelineTiming: {
        asrStartedAtMs: 10,
        asrFinalAtMs: 40,
        processingQueueEnteredAtMs: 41,
        processingQueueReleasedAtMs: 45,
      },
    }, 0).ready).toEqual([]);

    const result = assembler.push("session", {
      segmentId: "second",
      text: "然后确认负责人。",
      language: "zh",
      endpointReason: "silence",
      pipelineTiming: {
        asrStartedAtMs: 90,
        asrFinalAtMs: 120,
        processingQueueEnteredAtMs: 121,
        processingQueueReleasedAtMs: 125,
      },
    }, 100);

    expect(result.ready[0].text).toBe("今天讨论产品计划，然后确认负责人。");
    expect(result.ready[0].pipelineTiming).toEqual({
      asrStartedAtMs: 10,
      asrFinalAtMs: 120,
      processingQueueEnteredAtMs: 41,
      processingQueueReleasedAtMs: 125,
    });
  });

  it("holds an incomplete structured field long enough for its value", () => {
    const assembler = new SegmentAssembler();
    expect(assembler.push("session", {
      segmentId: "amount-label",
      text: "订单金额是。",
      language: "zh",
      endpointReason: "silence",
    }, 0).ready).toEqual([]);

    const result = assembler.push("session", {
      segmentId: "amount-value",
      text: "一千两百三十四点五六元。",
      language: "zh",
      endpointReason: "silence",
    }, 5200);

    expect(result.ready[0].text).toBe("订单金额是一千两百三十四点五六元。");
  });
});
