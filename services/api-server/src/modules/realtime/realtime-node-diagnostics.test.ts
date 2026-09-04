import { describe, expect, it } from "vitest";
import { parseRealtimeNodeDiagnostics } from "./realtime-node-diagnostics.js";

describe("realtime node diagnostics", () => {
  it("accepts bounded operational metrics and strips unknown payload", () => {
    const parsed = parseRealtimeNodeDiagnostics({
      ...node(),
      rawAudio: "must-not-persist",
    });

    expect(parsed).toMatchObject({
      nodeId: "node-a",
      runtimeId: "runtime-a",
      audioLegs: [{ legId: "guest:1", receivedFrames: 10 }],
      rtc: { attemptedSampleCount: 1 },
    });
    expect(parsed).not.toHaveProperty("rawAudio");
  });

  it("rejects inconsistent ring-buffer accounting", () => {
    const input = node();
    input.audioLegs[0]!.receivedFrames = 99;
    expect(parseRealtimeNodeDiagnostics(input)).toBeUndefined();
  });

  it("preserves the controlled reject-newest overflow policy", () => {
    const input = node();
    input.audioLegs[0]!.dropPolicy = "reject_newest";
    expect(parseRealtimeNodeDiagnostics(input)?.audioLegs[0]?.dropPolicy)
      .toBe("reject_newest");
  });

  it("rejects RTC samples outside the runtime window", () => {
    const input = node();
    input.rtc.samples[0]!.observedAtMs = 999;
    expect(parseRealtimeNodeDiagnostics(input)).toBeUndefined();
  });

  it("orders retained RTC samples before latest-counter aggregation", () => {
    const input = node();
    input.rtc.attemptedSampleCount = 2;
    input.rtc.samples.push({
      observedAtMs: 120,
      rttMs: 50,
      jitterMs: 10,
      packetsReceived: 40,
      packetsLost: 5,
    });

    expect(parseRealtimeNodeDiagnostics(input)?.rtc?.samples.map(
      (sample) => sample.observedAtMs,
    )).toEqual([120, 150]);
  });
});

function node() {
  return {
    nodeId: "node-a",
    runtimeId: "runtime-a",
    generation: 1,
    startedAtMs: 100,
    endedAtMs: 200,
    audioLegs: [{
      legId: "guest:1",
      speakerRole: "guest",
      dropPolicy: "drop_oldest",
      capacityFrames: 20,
      receivedFrames: 10,
      dequeuedFrames: 8,
      processedFrames: 7,
      failedFrames: 1,
      inFlightFrames: 0,
      droppedFrames: 2,
      overflowDroppedFrames: 2,
      shutdownDiscardedFrames: 0,
      sequenceGapFrames: 2,
      queueDepthFrames: 0,
      highWatermarkFrames: 20,
      backpressureEvents: 2,
    }],
    rtc: {
      attemptedSampleCount: 1,
      unavailableSampleCount: 0,
      discardedSampleCount: 0,
      samples: [{
        observedAtMs: 150,
        rttMs: 100,
        jitterMs: 20,
        packetsReceived: 90,
        packetsLost: 10,
      }],
    },
    modelFingerprints: [{
      stage: "asr",
      provider: "http_asr",
      model: "test-asr",
      fingerprint: "a".repeat(64),
    }],
  };
}
