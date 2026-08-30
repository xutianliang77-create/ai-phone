import { describe, expect, it } from "vitest";
import { parseRealtimeDiagnostics } from "./realtime-diagnostics.js";


const scheduler = {
  scheduledPushCount: 2,
  completedPushCount: 1,
  coalescedObservationCount: 1,
  invalidatedPushCount: 0,
  inFlight: true,
  resultReady: false,
  pendingAudioMs: 200,
  maxPendingAudioMs: 400,
  averagePushLatencyMs: 25,
  maxPushLatencyMs: 30,
  minimumPushAudioMs: 40,
};


describe("stable partial scheduler diagnostics", () => {
  it("preserves bounded scheduler evidence without unknown fields", () => {
    const parsed = parseRealtimeDiagnostics(input({
      ...scheduler,
      rawPendingAudio: "must-not-survive",
    }));

    expect(parsed?.vad?.stablePartial).toMatchObject(scheduler);
    expect(parsed?.vad?.stablePartial).not.toHaveProperty("rawPendingAudio");
  });

  it("rejects inconsistent scheduler counts and latency bounds", () => {
    const invalid = [
      { ...scheduler, completedPushCount: 3 },
      { ...scheduler, invalidatedPushCount: 2 },
      { ...scheduler, pendingAudioMs: 401 },
      { ...scheduler, averagePushLatencyMs: 31 },
      { ...scheduler, inFlight: "yes" },
    ];

    for (const value of invalid) {
      expect(parseRealtimeDiagnostics(input(value))).toBeUndefined();
    }
  });

  it("accepts null latency sentinels before a streaming push completes", () => {
    const parsed = parseRealtimeDiagnostics(input({
      ...scheduler,
      averagePushLatencyMs: null,
      maxPushLatencyMs: null,
      firstStablePartialLatencyMs: null,
      lastStablePartialLatencyMs: null,
    }));

    expect(parsed?.vad?.stablePartial).toBeDefined();
    expect(parsed?.vad?.stablePartial).not.toHaveProperty(
      "averagePushLatencyMs",
    );
    expect(parsed?.vad?.stablePartial).not.toHaveProperty("maxPushLatencyMs");
    expect(parsed?.vad?.stablePartial).not.toHaveProperty(
      "firstStablePartialLatencyMs",
    );
    expect(parsed?.vad?.stablePartial).not.toHaveProperty(
      "lastStablePartialLatencyMs",
    );
  });

  it("accounts for a confirmed decode used only as the final fallback", () => {
    const parsed = parseRealtimeDiagnostics(input({
      ...scheduler,
      decisionCount: 2,
      emittedCount: 0,
      rejectionCounts: {
        insufficient_units: 1,
        final_fallback: 1,
      },
    }));

    expect(parsed?.vad?.stablePartial?.rejectionCounts).toEqual({
      insufficient_units: 1,
      final_fallback: 1,
    });
  });
});


function input(stablePartial: Record<string, unknown>) {
  return {
    version: 1,
    audio: {
      receivedFrameCount: 1,
      processedBatchCount: 1,
      droppedFrameCount: 0,
    },
    vad: {
      configuredProvider: "marblenet",
      activeProvider: "marblenet",
      threshold: 0.5,
      analyzedFrameCount: 1,
      speechFrameCount: 1,
      speechFrameRatio: 1,
      fallbackCount: 0,
      endpointPolicy: {
        mode: "listening",
        minAudioMs: 500,
        endpointSilenceMs: 1400,
        maxAudioMs: 10000,
        prerollMs: 400,
        fingerprint: "b".repeat(64),
      },
      stablePartial: {
        enabled: true,
        policy: "qwen17_chunk_aware_extension_survival_zh_v5",
        eligibleSegmentCount: 1,
        activeSegment: true,
        decodeCount: 2,
        decisionCount: 2,
        emittedCount: 0,
        rejectionCounts: { no_text: 1, extension_pending: 1 },
        ...stablePartial,
      },
    },
  };
}
