import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkRealtimeObservabilityAssets,
  validateRealtimeObservabilityAssets,
} from "./realtime_observability_assets.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("realtime observability assets", () => {
  it("keeps model, realtime, collector and dashboard contracts aligned", () => {
    expect(checkRealtimeObservabilityAssets(root)).toMatchObject({
      status: "ready",
      metricCount: 12,
      scrapeJobCount: 4,
      thresholdsCalibrated: false,
    });
  });

  it("rejects an uncalibrated dashboard alert", () => {
    const result = validateRealtimeObservabilityAssets({
      contract: {
        schemaVersion: 1,
        metrics: [],
        cardinalityPolicy: { forbiddenLabels: [] },
        rtcThresholdPolicy: { status: "ready", thresholds: { rttMs: 1 } },
      },
      collector: "",
      dashboard: { panels: [{ alert: { name: "premature" } }] },
      sources: [],
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "RTC thresholds must remain unset until staging calibration",
    );
    expect(result.issues).toContain(
      "dashboard must not define uncalibrated RTC alert thresholds",
    );
  });

  it("rejects the collector default internal metrics port", () => {
    const input = {
      contract: {
        schemaVersion: 1,
        metrics: ["implemented_metric"],
        cardinalityPolicy: { forbiddenLabels: [] },
        rtcThresholdPolicy: { status: "calibration_required", thresholds: null },
      },
      collector: [
        ...["wujie-api-realtime", "wujie-asr-model", "wujie-translation-model", "wujie-tts-model"]
          .map((job) => `job_name: ${job}`),
        ...["API_METRICS_TARGET", "ASR_METRICS_TARGET", "TRANSLATION_METRICS_TARGET", "TTS_METRICS_TARGET"]
          .map((target) => `\${env:${target}}`),
        'credentials: "${env:METRICS_BEARER_TOKEN}"',
        'metrics_endpoint: "${env:OTEL_METRICS_EXPORT_ENDPOINT}"',
        "exporters: [otlphttp/metrics]",
        'host: "127.0.0.1"',
        "port: 8888",
      ].join("\n"),
      dashboard: { panels: [] },
      sources: ["implemented_metric"],
    };

    expect(validateRealtimeObservabilityAssets(input).issues).toContain(
      "OTel collector internal metrics must use isolated port 18888",
    );
  });
});
