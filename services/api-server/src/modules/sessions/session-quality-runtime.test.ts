import { describe, expect, it } from "vitest";
import type { RealtimeNodeDiagnosticsDto } from "@translation/contracts";
import type { SessionRecord } from "./session-record.js";
import { runtimeQualitySummary } from "./session-quality-runtime.js";

describe("session runtime quality", () => {
  it("aggregates per-node ingest, RTC and model fingerprints", () => {
    const session = baseSession();
    session.diagnostics = {
      version: 1,
      audio: {
        receivedFrameCount: 20,
        processedBatchCount: 16,
        droppedFrameCount: 4,
      },
      nodes: [node("node-a", "runtime-a", 100, "a"),
        node("node-b", "runtime-b", 300, "b")],
    };

    const result = runtimeQualitySummary(session);

    expect(result.summary).toMatchObject({
      ingest: {
        nodeCount: 2,
        runtimeCount: 2,
        legCount: 2,
        droppedFrames: 4,
        sequenceGapFrames: 4,
        backpressureEvents: 4,
        highWatermarkRatio: 1,
      },
      rtc: {
        sampleCount: 2,
        rtt: { averageMs: 200, p50Ms: 100, p95Ms: 300 },
        jitter: { averageMs: 20, p50Ms: 10, p95Ms: 30 },
        packetsReceived: 180,
        packetsLost: 20,
        packetLossRate: 0.1,
      },
      modelFingerprints: [
        { fingerprint: "a".repeat(64), runtimeCount: 1 },
        { fingerprint: "b".repeat(64), runtimeCount: 1 },
      ],
    });
    expect(result.flags).toEqual([
      "audio_sequence_gaps",
      "audio_backpressure",
      "mixed_model_fingerprints",
    ]);
  });
});

function node(
  nodeId: string,
  runtimeId: string,
  rttMs: number,
  fingerprint: string,
): RealtimeNodeDiagnosticsDto {
  return {
    nodeId,
    runtimeId,
    startedAtMs: 0,
    endedAtMs: 1_000,
    audioLegs: [{
      legId: "guest:1",
      speakerRole: "guest",
      dropPolicy: "drop_oldest",
      capacityFrames: 20,
      receivedFrames: 10,
      dequeuedFrames: 8,
      processedFrames: 8,
      failedFrames: 0,
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
        observedAtMs: 500,
        rttMs,
        jitterMs: rttMs / 10,
        packetsReceived: 90,
        packetsLost: 10,
      }],
    },
    modelFingerprints: [{
      stage: "asr",
      provider: "http_asr",
      fingerprint: fingerprint.repeat(64),
    }],
  };
}

function baseSession(): SessionRecord {
  return {
    id: "session-a",
    userId: "user-a",
    mode: "call_link",
    status: "ended",
    consumedSeconds: 1,
    createdAt: new Date(0).toISOString(),
    segments: [],
  };
}
