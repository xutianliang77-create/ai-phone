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
        policy: "qwen17_latest_only_adjacent_prefix_zh_v2",
        eligibleSegmentCount: 1,
        activeSegment: true,
        decodeCount: 1,
        decisionCount: 1,
        emittedCount: 0,
        rejectionCounts: { no_text: 1 },
        ...stablePartial,
      },
    },
  };
}
