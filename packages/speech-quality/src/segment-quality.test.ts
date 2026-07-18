import { describe, expect, it } from "vitest";
import { SegmentAssembler } from "./segment-assembler.js";

describe("shared speech quality", () => {
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
});
