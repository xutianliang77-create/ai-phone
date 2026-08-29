import { describe, expect, it } from "vitest";
import { isAsrTokenTiming, isAsrTokenTimings } from "./asr-timing.js";

describe("ASR token timing contract", () => {
  it("accepts monotonic token timing with optional character ranges", () => {
    expect(isAsrTokenTimings([
      {
        text: "Qwen3-ASR",
        startMs: 100,
        endMs: 460,
        confidence: 0.92,
        characterStart: 0,
        characterEnd: 9,
      },
      {
        text: "测试",
        startMs: 480,
        endMs: 720,
        characterStart: 9,
        characterEnd: 11,
      },
    ])).toBe(true);
  });

  it("rejects invalid ranges, confidence, order, and unbounded arrays", () => {
    expect(isAsrTokenTiming({ text: "x", startMs: 2, endMs: 1 })).toBe(false);
    expect(isAsrTokenTiming({
      text: "x",
      startMs: 0,
      endMs: 1,
      confidence: 1.1,
    })).toBe(false);
    expect(isAsrTokenTimings([
      { text: "later", startMs: 20, endMs: 30 },
      { text: "earlier", startMs: 10, endMs: 15 },
    ])).toBe(false);
    expect(isAsrTokenTimings(Array.from(
      { length: 2_049 },
      () => ({ text: "x", startMs: 0, endMs: 1 }),
    ))).toBe(false);
  });
});
