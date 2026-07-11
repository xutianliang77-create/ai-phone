import { describe, expect, test } from "vitest";
import {
  effectiveDeferredEvidenceActions,
  effectiveDeferredEvidenceIssues,
  effectiveDeferredEvidenceStatus,
  effectiveWaitDeviceIssuesForMarkdown,
} from "./ios_nemotron_report_deferred_evidence.mjs";

describe("effectiveWaitDeviceIssuesForMarkdown", () => {
  test("hides stale wait-device issues when current physical readiness is present", () => {
    const issues = effectiveWaitDeviceIssuesForMarkdown(
      { issues: ["readiness JSON is stale", "wait-device log is stale"] },
      { fresh: true },
      {
        checks: [{
          name: "physical_iphone_readiness",
          status: "fail",
          details: { ready: false },
        }],
      },
    );

    expect(issues).toEqual([]);
  });

  test("keeps wait-device issues when current physical readiness is unavailable", () => {
    const issues = effectiveWaitDeviceIssuesForMarkdown(
      { issues: ["readiness JSON is stale"] },
      { fresh: false },
      { checks: [] },
    );

    expect(issues).toEqual(["readiness JSON is stale"]);
  });

  test("defers provisioning and signed build issues until iPhone is ready", () => {
    const statusEvidence = { fresh: true };
    const status = {
      checks: [
        {
          name: "physical_iphone_readiness",
          status: "fail",
          details: {
            devices: [{
              name: "Wha的iPhone",
              actions: ["enable Developer Mode"],
            }],
          },
        },
        {
          name: "ios_signed_device_build",
          status: "pending",
          message: "waiting for physical_iphone_readiness",
        },
      ],
    };

    expect(effectiveDeferredEvidenceIssues(
      "ios_signed_device_build",
      ["old signing failure"],
      statusEvidence,
      status,
    )).toEqual(["waiting for physical_iphone_readiness"]);
    expect(effectiveDeferredEvidenceActions(
      ["old signing action"],
      statusEvidence,
      status,
    )).toEqual(["Wha的iPhone: enable Developer Mode"]);
    expect(effectiveDeferredEvidenceStatus(
      "fail",
      statusEvidence,
      status,
    )).toBe("waiting_on_physical_iphone");
  });
});
