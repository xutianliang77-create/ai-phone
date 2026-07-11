import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadWaitDeviceEvidence } from "./ios_nemotron_wait_device_evidence.mjs";

let tempDir = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("loadWaitDeviceEvidence", () => {
  test("summarizes readiness JSON and wait-device log", () => {
    const now = Date.parse("2026-06-27T17:10:00.000Z");
    tempDir = mkdtempSync(path.join(tmpdir(), "wait-device-"));
    const readinessJson = path.join(tempDir, "readiness.json");
    const waitLog = path.join(tempDir, "wait.log");
    writeFileSync(readinessJson, JSON.stringify({
      ready: false,
      requestedDevice: "Wha的iPhone",
      physicalDeviceCount: 1,
      matchedDeviceCount: 1,
      devices: [{
        name: "Wha的iPhone",
        model: "iPhone 13 Pro Max",
        osVersion: "26.3",
        pairingState: "paired",
        developerModeStatus: "disabled",
        tunnelState: "unavailable",
        ready: false,
        matched: true,
        actions: ["enable iOS Developer Mode on the iPhone, then reconnect it."],
      }],
    }));
    writeFileSync(waitLog, "Attempt 1\nRefreshing MVP acceptance report\n");
    setMtime(readinessJson, now);
    setMtime(waitLog, now);

    const evidence = loadWaitDeviceEvidence(readinessJson, waitLog, 2, now);

    expect(evidence).toMatchObject({
      ready: false,
      requestedDevice: "Wha的iPhone",
      physicalDeviceCount: 1,
      matchedDeviceCount: 1,
      readiness: { exists: true, fresh: true, valid: true },
      log: { exists: true, fresh: true, attempted: true, reportRefreshed: true },
      devices: [{ developerModeStatus: "disabled", tunnelState: "unavailable" }],
      actions: ["Wha的iPhone: enable iOS Developer Mode on the iPhone, then reconnect it."],
      issues: [],
    });
  });

  test("reports missing evidence files", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "wait-device-missing-"));
    const evidence = loadWaitDeviceEvidence(
      path.join(tempDir, "readiness.json"),
      path.join(tempDir, "wait.log"),
      2,
      Date.now(),
    );

    expect(evidence.ready).toBe(false);
    expect(evidence.readiness.exists).toBe(false);
    expect(evidence.log.exists).toBe(false);
    expect(evidence.issues).toContain("readiness JSON is missing");
    expect(evidence.issues).toContain("wait-device log is missing");
  });
});

function setMtime(file, timeMs) {
  const date = new Date(timeMs);
  utimesSync(file, date, date);
}
