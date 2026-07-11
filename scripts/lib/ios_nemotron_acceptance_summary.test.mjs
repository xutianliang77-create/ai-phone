import { describe, expect, test } from "vitest";
import { buildAcceptanceSummary } from "./ios_nemotron_acceptance_summary.mjs";

describe("buildAcceptanceSummary", () => {
  test("does not surface stale wait-device issues when status has current physical readiness", () => {
    const summary = buildAcceptanceSummary(makeInput({
      statusEvidence: {
        fresh: true,
        payload: {
          deviceId: "Wha的iPhone",
          checks: [{
            name: "physical_iphone_readiness",
            status: "fail",
            message: "Developer Mode disabled.",
            details: { ready: false },
          }],
        },
      },
      waitDeviceEvidence: {
        issues: ["readiness JSON is stale", "wait-device log is stale"],
      },
    }));

    expect(summary.schemaVersion).toBe(11);
    expect(summary.requiredRuntimeContract).toEqual({
      deviceAsrProvider: "coreml_nemotron",
      modelChunkMs: 2240,
      autoDownloadModel: false,
      gatewayProvider: "lmstudio",
      gatewayAsrProvider: "mock",
      gatewaySessionEventSink: "api",
    });
    expect(summary.evidenceIssues.waitDevice).toEqual([]);
  });

  test("hides stale provisioning and signed build issues until iPhone is ready", () => {
    const summary = buildAcceptanceSummary(makeInput({
      statusEvidence: {
        fresh: true,
        payload: {
          deviceId: "Wha的iPhone",
          checks: [{
            name: "physical_iphone_readiness",
            status: "fail",
            message: "Developer Mode disabled.",
            details: {
              devices: [{ name: "Wha的iPhone", actions: ["enable Developer Mode"] }],
            },
          }],
        },
      },
      provisioningRepairEvidence: evidence("repair.json", {
        issues: ["old repair failure"],
        actions: ["old repair action"],
      }),
      signedBuildEvidence: evidence("signed.json", {
        issues: ["old signed build failure"],
        actions: ["old signed build action"],
      }),
    }));

    expect(summary.evidenceIssues.provisioningRepair).toEqual([]);
    expect(summary.evidenceIssues.signedBuild).toEqual([]);
    expect(summary.evidenceActions.provisioningRepair).toEqual([
      "Wha的iPhone: enable Developer Mode",
    ]);
    expect(summary.evidenceActions.signedBuild).toEqual([
      "Wha的iPhone: enable Developer Mode",
    ]);
  });

  test("keeps wait-device issues when current physical readiness is unavailable", () => {
    const summary = buildAcceptanceSummary(makeInput({
      statusEvidence: {
        fresh: false,
        payload: {
          deviceId: "Wha的iPhone",
          checks: [],
        },
      },
      waitDeviceEvidence: {
        issues: ["readiness JSON is stale"],
      },
    }));

    expect(summary.evidenceIssues.waitDevice).toEqual([
      "readiness JSON is stale",
    ]);
  });
});

function makeInput(overrides = {}) {
  const statusEvidence = {
    source: "status.json",
    fresh: true,
    generatedAt: "2026-06-28T00:00:00.000Z",
    ageHours: 0,
    maxAgeHours: 2,
    payload: {
      deviceId: "Wha的iPhone",
      checks: [],
    },
    ...overrides.statusEvidence,
  };
  const waitDeviceEvidence = {
    readinessPath: "readiness.json",
    logPath: "wait.log",
    readiness: {},
    log: {},
    ready: false,
    requestedDevice: "Wha的iPhone",
    physicalDeviceCount: 1,
    matchedDeviceCount: 1,
    devices: [],
    issues: [],
    actions: [],
    ...overrides.waitDeviceEvidence,
  };

  return {
    generatedAt: "2026-06-28T00:00:00.000Z",
    ready: false,
    markdownOutput: "report.md",
    statusEvidence,
    preflightEvidence: evidence("preflight.json"),
    provisioningRepairEvidence: evidence("repair.json"),
    signedBuildEvidence: evidence("signed.json"),
    lmStudioProviderEvidence: evidence("lmstudio.json"),
    smokeEvidence: { ...logEvidence("smoke.log"), markers: [], results: [] },
    gatewayEvidence: logEvidence("gateway.log"),
    waitDeviceEvidence,
    gatewayRows: [],
    failedGates: [],
    pendingGates: [],
    missingSmoke: [],
    missingGateway: [],
    requiredRuntimeContract: {
      deviceAsrProvider: "coreml_nemotron",
      modelChunkMs: 2240,
      autoDownloadModel: false,
      gatewayProvider: "lmstudio",
      gatewayAsrProvider: "mock",
      gatewaySessionEventSink: "api",
    },
    nextActions: "",
  };
}

function evidence(path, overrides = {}) {
  return {
    path,
    pass: false,
    issues: [],
    actions: [],
    ...overrides,
  };
}

function logEvidence(path) {
  return {
    path,
    fresh: false,
    freshness: "missing",
    issues: [],
  };
}
