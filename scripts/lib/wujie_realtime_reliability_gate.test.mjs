import { describe, expect, it } from "vitest";
import {
  evaluateLongResult,
  percentile,
  summarizeTailResults,
} from "../run_wujie_realtime_reliability_gate.mjs";

describe("Wujie realtime reliability gates", () => {
  it("calculates nearest-rank latency percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(percentile([], 0.95)).toBeNull();
  });

  it("requires at least 99 percent successful tail sessions", () => {
    const passing = Array.from({ length: 99 }, (_, index) => ({
      ok: true,
      endLatencyMs: 1000 + index,
    }));
    expect(summarizeTailResults([...passing, { ok: false }])).toMatchObject({
      ok: true,
      passed: 99,
      failed: 1,
      required: 99,
    });
    expect(summarizeTailResults([
      ...passing.slice(0, 98),
      { ok: false },
      { ok: false },
    ]).ok).toBe(false);
  });

  it("gates wall time, segments, translations, drops and error events", () => {
    const result = {
      wallDurationMs: 1_800_001,
      serverDurationMs: 1_800_001,
      sequence: 22_000,
      receivedFrameCount: 22_000,
      segments: Array.from({ length: 100 }, (_, index) => ({
        sourceText: `source ${index}`,
        translatedText: `translation ${index}`,
      })),
      droppedFrameCount: 0,
      eventErrors: [],
      endReason: "client_request",
      flush: { status: "completed" },
    };
    expect(evaluateLongResult(result, {
      minimumWallDurationMs: 1_800_000,
      minimumSegments: 100,
      minimumTranslationCoverage: 0.99,
    })).toMatchObject({ ok: true, translationCoverage: 1 });

    expect(evaluateLongResult({
      ...result,
      droppedFrameCount: 1,
      eventErrors: [{ type: "error" }],
    }, {
      minimumWallDurationMs: 1_800_000,
      minimumSegments: 100,
      minimumTranslationCoverage: 0.99,
    }).ok).toBe(false);
  });

  it("rejects client-wall-time false positives after a server time limit", () => {
    const result = {
      wallDurationMs: 1_846_290,
      serverDurationMs: 1_800_409,
      sequence: 22_705,
      receivedFrameCount: 22_133,
      segments: Array.from({ length: 256 }, (_, index) => ({
        sourceText: `source ${index}`,
        translatedText: `translation ${index}`,
      })),
      droppedFrameCount: 0,
      eventErrors: [],
      endReason: "time_limit",
      flush: { status: "completed" },
    };

    const gate = evaluateLongResult(result, {
      minimumWallDurationMs: 1_800_000,
      minimumSegments: 100,
      minimumTranslationCoverage: 0.99,
    });

    expect(gate.ok).toBe(false);
    expect(gate.frameCoverage).toBeCloseTo(22_133 / 22_705);
    expect(gate.errors).toEqual(expect.arrayContaining([
      "server received 22133 of 22705 sent frames",
      "session ended with time_limit",
    ]));
  });
});
