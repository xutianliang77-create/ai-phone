import { describe, expect, it } from "vitest";
import {
  extractRtcSample,
  LiveKitRtcDiagnosticsCollector,
} from "./livekit-rtc-diagnostics.js";

describe("LiveKit RTC diagnostics", () => {
  it("extracts audio loss, jitter and candidate RTT from RTC stats", () => {
    expect(extractRtcSample(stats(), 123)).toEqual({
      observedAtMs: 123,
      rttMs: 100,
      jitterMs: 20,
      packetsReceived: 90,
      packetsLost: 10,
    });
  });

  it("samples once on start and once before stop", async () => {
    let now = 100;
    const collector = new LiveKitRtcDiagnosticsCollector({
      getRtcStats: async () => stats(),
    }, 60_000, () => ++now);

    collector.start();
    const diagnostics = await collector.stop();

    expect(diagnostics).toMatchObject({
      attemptedSampleCount: 2,
      unavailableSampleCount: 0,
      discardedSampleCount: 0,
    });
    expect(diagnostics.samples).toHaveLength(2);
  });
});

function stats() {
  return {
    publisherStats: [{
      stats: {
        case: "candidatePair",
        value: { candidatePair: { currentRoundTripTime: 0.1 } },
      },
    }],
    subscriberStats: [{
      stats: {
        case: "inboundRtp",
        value: {
          stream: { kind: "audio" },
          received: {
            packetsReceived: 90n,
            packetsLost: 10n,
            jitter: 0.02,
          },
        },
      },
    }],
  };
}
