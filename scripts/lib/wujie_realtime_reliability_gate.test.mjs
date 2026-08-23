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
      segments: Array.from({ length: 100 }, (_, index) => ({
        sourceText: `source ${index}`,
        translatedText: `translation ${index}`,
      })),
      droppedFrameCount: 0,
      eventErrors: [],
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
});
