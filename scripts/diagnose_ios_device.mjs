#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildDiagnostic,
  deviceSummary,
  matchesDevice,
  remediationActions,
} from "./lib/ios_device_readiness.mjs";

const args = process.argv.slice(2);
const requireReadyFlag = takeFlag("--require-ready");
const requireReady =
  process.env.IOS_DEVICE_REQUIRE_READY === "true" ||
  requireReadyFlag;
const outputJson = takeFlag("--json");
const requestedDevice = process.env.DEVICE_ID || positionalDevice() || "";
const tempDir = mkdtempSync(path.join(tmpdir(), "ios-device-diagnostic-"));
const jsonPath = path.join(tempDir, "devices.json");

try {
  main();
} catch (error) {
  const message = `Unable to run devicectl iOS diagnostic: ${errorMessage(error)}`;
  if (outputJson) {
    printJson({
      schemaVersion: 1,
      requestedDevice: requestedDevice || null,
      ready: false,
      physicalDeviceCount: 0,
      matchedDeviceCount: 0,
      devices: [],
      error: message,
    });
  } else {
    console.error(message);
  }
  if (requireReady) process.exitCode = 2;
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function main() {
  execFileSync("xcrun", [
    "devicectl",
    "list",
    "devices",
    "--timeout",
    "5",
    "--json-output",
    jsonPath,
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const payload = JSON.parse(readFileSync(jsonPath, "utf8"));
  const devices = (payload.result?.devices ?? [])
    .filter((device) =>
      device.hardwareProperties?.platform === "iOS" &&
      device.hardwareProperties?.reality === "physical"
    );

  const matches = requestedDevice
    ? devices.filter((device) => matchesDevice(device, requestedDevice))
    : devices;
  const diagnostic = buildDiagnostic(devices, matches, requestedDevice);

  if (outputJson) {
    printJson(diagnostic);
  }

  if (devices.length === 0) {
    if (!outputJson) {
      console.error("devicectl did not report any physical iOS devices.");
    }
    if (requireReady) process.exitCode = 2;
    return;
  }

  if (matches.length === 0) {
    if (!outputJson) {
      console.error(`devicectl found physical iOS devices, but none matched DEVICE_ID=${requestedDevice}.`);
      for (const device of devices) printDeviceSummary(device);
    }
    if (requireReady) process.exitCode = 2;
    return;
  }

  if (!outputJson) {
    console.error("iOS device diagnostic from devicectl:");
    for (const device of matches) {
      printDeviceSummary(device);
      printRemediation(device);
    }
  }
  if (requireReady && !diagnostic.ready) {
    if (!outputJson) {
      console.error("iOS device is not ready for real-device Nemotron smoke.");
    }
    process.exitCode = 2;
  }
}

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function positionalDevice() {
  return args.find((arg) => !arg.startsWith("-"));
}

function printDeviceSummary(device) {
  const summary = deviceSummary(device);
  console.error(`  ${summary.name} (${summary.model}, iOS ${summary.osVersion})`);
  console.error(`    udid=${summary.udid}`);
  console.error(`    identifier=${summary.identifier}`);
  console.error(`    pairingState=${summary.pairingState}`);
  console.error(`    developerModeStatus=${summary.developerModeStatus}`);
  console.error(`    tunnelState=${summary.tunnelState}`);
  console.error(`    lastConnectionDate=${summary.lastConnectionDate}`);
}

function printRemediation(device) {
  for (const action of remediationActions(device)) {
    console.error(`    action: ${action}`);
  }
}

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
