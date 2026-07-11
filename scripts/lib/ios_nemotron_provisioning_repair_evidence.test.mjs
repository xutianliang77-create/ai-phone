import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadProvisioningRepairEvidence } from "./ios_nemotron_provisioning_repair_evidence.mjs";

let tempDir;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { force: true, recursive: true });
  tempDir = null;
});

describe("loadProvisioningRepairEvidence", () => {
  test("reports missing repair evidence with a runnable action", () => {
    const evidence = loadProvisioningRepairEvidence(
      "/tmp/missing-provisioning-repair.json",
      24,
      Date.parse("2026-06-27T16:00:00.000Z"),
    );

    expect(evidence.exists).toBe(false);
    expect(evidence.pass).toBe(false);
    expect(evidence.status).toBe("missing");
    expect(evidence.actions.join("\n")).toContain("repair-provisioning");
  });

  test("summarizes device readiness failure without losing profile issues", () => {
    const file = writeRepairJson({
      status: "fail",
      stage: "device_readiness",
      generatedAt: "2026-06-27T16:00:00.000Z",
      message: "iPhone is not ready for provisioning repair",
      deviceDiagnostic: {
        devices: [
          {
            actions: [
              "enable iOS Developer Mode on the iPhone, then reconnect it.",
            ],
          },
        ],
      },
      profileBefore: {
        issues: ["No local iOS provisioning profiles were found."],
        actions: [
          "After the iPhone is ready, let Xcode register the device.",
        ],
      },
    });

    const evidence = loadProvisioningRepairEvidence(
      file,
      24,
      Date.parse("2026-06-27T17:00:00.000Z"),
    );

    expect(evidence.exists).toBe(true);
    expect(evidence.pass).toBe(false);
    expect(evidence.freshness).toBe("fresh");
    expect(evidence.ageHours).toBe(1);
    expect(evidence.issues).toEqual([
      "iPhone is not ready for provisioning repair",
      "No local iOS provisioning profiles were found.",
    ]);
    expect(evidence.actions).toEqual([
      "enable iOS Developer Mode on the iPhone, then reconnect it.",
      "After the iPhone is ready, let Xcode register the device.",
    ]);
  });

  test("marks old pass evidence stale", () => {
    const file = writeRepairJson({
      status: "pass",
      stage: "repaired",
      generatedAt: "2026-06-27T00:00:00.000Z",
      profileAfter: {
        issues: [],
        actions: [],
      },
    });

    const evidence = loadProvisioningRepairEvidence(
      file,
      2,
      Date.parse("2026-06-27T03:00:00.000Z"),
    );

    expect(evidence.pass).toBe(false);
    expect(evidence.freshness).toBe("stale");
  });
});

function writeRepairJson(payload) {
  tempDir = mkdtempSync(path.join(tmpdir(), "provisioning-repair-test-"));
  const file = path.join(tempDir, "repair.json");
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}
