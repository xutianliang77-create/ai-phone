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
});
