import { describe, expect, it } from "vitest";
import { loadEnv } from "../config/env.js";
import {
  buildRealtimeNodeDiagnostics,
  workerModelFingerprints,
} from "./call-runtime-diagnostics.js";

describe("call runtime diagnostics", () => {
  it("fingerprints safe model parameters and changes with runtime settings", () => {
    const env = loadEnv();
    env.translationApiKey = "must-not-leak";
    const first = workerModelFingerprints(env, "call_link");
    env.translationMaxTokens += 1;
    const second = workerModelFingerprints(env, "call_link");

    expect(first.find((item) => item.stage === "translation")?.fingerprint)
      .not.toBe(second.find((item) => item.stage === "translation")?.fingerprint);
    expect(JSON.stringify(first)).not.toContain("must-not-leak");
  });

  it("binds per-leg, RTC and model evidence to one runtime", () => {
    const env = loadEnv();
    env.diagnosticsNodeId = "worker-a";
    const diagnostics = buildRealtimeNodeDiagnostics(env, {
      audioLegs: [leg()],
      rtc: {
        attemptedSampleCount: 1,
        unavailableSampleCount: 0,
        discardedSampleCount: 0,
        samples: [{ observedAtMs: 150, rttMs: 20 }],
      },
    }, {
      runtimeId: "runtime-a",
      generation: 2,
      startedAtMs: 100,
      endedAtMs: 200,
    });

    expect(diagnostics).toMatchObject({
      nodeId: "worker-a",
      runtimeId: "runtime-a",
      generation: 2,
      audioLegs: [{ legId: "guest:1", receivedFrames: 1 }],
    });
    expect(diagnostics.modelFingerprints.map((item) => item.stage))
      .toEqual(expect.arrayContaining(["pipeline", "asr", "translation"]));
  });
});

function leg() {
  return {
    legId: "guest:1",
    speakerRole: "guest" as const,
    dropPolicy: "drop_oldest" as const,
    capacityFrames: 20,
    receivedFrames: 1,
    dequeuedFrames: 1,
    processedFrames: 1,
    failedFrames: 0,
    inFlightFrames: 0,
    droppedFrames: 0,
    overflowDroppedFrames: 0,
    shutdownDiscardedFrames: 0,
    sequenceGapFrames: 0,
    queueDepthFrames: 0,
    highWatermarkFrames: 1,
    backpressureEvents: 0,
  };
}
