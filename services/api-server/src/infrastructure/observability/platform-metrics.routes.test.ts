import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RealtimeNodeDiagnosticsDto } from "@translation/contracts";
import { buildApp } from "../../app.js";
import {
  observeRealtimeRuntime,
  resetRealtimePrometheusMetricsForTests,
} from "./realtime-prometheus.js";
import { getPlatformMetricsReadiness } from "./platform-metrics.routes.js";

describe("platform metrics routes", () => {
  const previousToken = process.env.METRICS_BEARER_TOKEN;

  beforeEach(() => {
    process.env.METRICS_BEARER_TOKEN = "metrics-secret";
    resetRealtimePrometheusMetricsForTests();
  });

  afterEach(() => {
    resetRealtimePrometheusMetricsForTests();
    if (previousToken === undefined) delete process.env.METRICS_BEARER_TOKEN;
    else process.env.METRICS_BEARER_TOKEN = previousToken;
  });

  it("exports bounded low-cardinality realtime gauges without retry inflation", async () => {
    observeRealtimeRuntime(node(10));
    observeRealtimeRuntime(node(12));
    const app = await buildApp();

    const unauthorized = await app.inject({ method: "GET", url: "/metrics" });
    const response = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer metrics-secret" },
    });
    await app.close();

    expect(unauthorized.statusCode).toBe(401);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain(
      'wujie_realtime_runtime_count{worker_node="node-a"} 1',
    );
    expect(response.body).toContain(
      'wujie_realtime_audio_frames{worker_node="node-a",state="received"} 12',
    );
    expect(response.body).toContain(
      'wujie_realtime_rtc_rtt_ms{worker_node="node-a",quantile="0.95"} 300',
    );
    expect(response.body).toContain("configuration_fingerprint");
    expect(response.body).not.toContain("runtime-a");
    expect(response.body).not.toContain("metrics-secret");
  });

  it("fails closed when the scrape token is not configured", async () => {
    delete process.env.METRICS_BEARER_TOKEN;
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/metrics" });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(getPlatformMetricsReadiness()).toMatchObject({
      status: "not_ready",
      tokenConfigured: false,
      rtcThresholds: "calibration_required",
    });
  });
});

function node(receivedFrames: number): RealtimeNodeDiagnosticsDto {
  return {
    nodeId: "node-a",
    runtimeId: "runtime-a",
    startedAtMs: 100,
    endedAtMs: 200,
    audioLegs: [{
      legId: "guest:1",
      speakerRole: "guest",
      dropPolicy: "drop_oldest",
      capacityFrames: 20,
      receivedFrames,
      dequeuedFrames: receivedFrames,
      processedFrames: receivedFrames,
      failedFrames: 0,
      inFlightFrames: 0,
      droppedFrames: 0,
      overflowDroppedFrames: 0,
      shutdownDiscardedFrames: 0,
      sequenceGapFrames: 0,
      queueDepthFrames: 0,
      highWatermarkFrames: 10,
      backpressureEvents: 0,
    }],
    rtc: {
      attemptedSampleCount: 2,
      unavailableSampleCount: 0,
      discardedSampleCount: 0,
      samples: [
        { observedAtMs: 120, rttMs: 100, jitterMs: 10 },
        {
          observedAtMs: 180,
          rttMs: 300,
          jitterMs: 30,
          packetsReceived: 90,
          packetsLost: 10,
        },
      ],
    },
    modelFingerprints: [{
      stage: "asr",
      provider: "http_asr",
      model: "test-asr",
      fingerprint: "a".repeat(64),
    }],
  };
}
