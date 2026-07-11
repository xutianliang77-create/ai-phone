#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { nextActionText } from "./lib/ios_nemotron_next_actions.mjs";
import { buildStatusChecks } from "./lib/ios_nemotron_status_checks.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const statusSchemaVersion = 15;
const json = takeFlag("--json");
const strict = takeFlag("--strict");
const help = takeFlag("--help") || takeFlag("-h");
const noSave = takeFlag("--no-save");
const statusJson = path.resolve(
  root,
  valueFlag("--status-json") ?? ".cache/ios-nemotron-services/mvp-status.json",
);
const simulatorBuiltApp = path.resolve(
  root,
  args.shift() ?? "apps/mobile/build/ios/iphonesimulator/Runner.app",
);
const deviceBuiltApp = path.resolve(
  root,
  process.env.IOS_DEVICE_BUILT_APP ?? "apps/mobile/build/ios/iphoneos/Runner.app",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const checks = await buildStatusChecks({
  root,
  simulatorBuiltApp,
  deviceBuiltApp,
});
const summary = {
  schemaVersion: statusSchemaVersion,
  generatedAt: new Date().toISOString(),
  overall: checks.every((check) => check.status === "pass") ? "pass" : "not_ready",
  builtApp: simulatorBuiltApp,
  simulatorBuiltApp,
  deviceBuiltApp,
  deviceId: process.env.DEVICE_ID || null,
  checks,
};

if (!noSave) writeStatusJson(summary);
if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  printHuman(summary);
}

if (strict && summary.overall !== "pass") process.exit(1);

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function valueFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  args.splice(index, 2);
  return value;
}

function writeStatusJson(summary) {
  mkdirSync(path.dirname(statusJson), { recursive: true });
  writeFileSync(statusJson, `${JSON.stringify(summary, null, 2)}\n`);
}

function printHuman(summary) {
  console.log(`iOS Nemotron MVP status: ${summary.overall}`);
  for (const check of summary.checks) {
    const marker = check.status.toUpperCase();
    console.log(`[${marker}] ${check.name}: ${check.message}`);
  }
  if (summary.overall !== "pass") {
    console.log("Next:");
    console.log(nextActionText({
      statusEvidence: { fresh: true, payload: summary },
      failedChecks: summary.checks.filter((check) => check.status === "fail"),
      pendingChecks: summary.checks.filter((check) => check.status === "pending"),
      preflightEvidence: { pass: true },
      provisioningRepairEvidence: { issues: [], actions: [] },
      signedBuildEvidence: { issues: [], actions: [] },
      smokeEvidence: { fresh: true },
      gatewayEvidence: { fresh: true },
      missingSmoke: [],
      missingGateway: [],
    }));
  }
}

function usage() {
  console.log(`Usage:
  scripts/ios_nemotron_mvp_status.mjs [--json] [--strict] [BUILT_RUNNER_APP]
  scripts/ios_nemotron_mvp_status.mjs [--status-json PATH] [--no-save]

Checks the current iOS Nemotron MVP gates without launching the app:
  - iOS permission metadata
  - mobile Chinese interface metadata
  - iOS signing settings for physical iPhone install
  - local iOS provisioning profile for the selected iPhone
  - iOS CoreML runtime target and FluidAudio package pin
  - Flutter/iOS native ASR bridge contract
  - Flutter/iOS on-device translation bridge contract
  - final iPhone MVP smoke contract
  - iPhone signing/provisioning repair contract
  - staged Nemotron CoreML model
  - simulator build output
  - simulator built app Models resource
  - iPhoneOS no-codesign build output
  - iPhoneOS built app Models resource
  - physical iPhone readiness
  - signed iPhoneOS build evidence after the iPhone is ready
  - LM Studio translation provider evidence
  - optional API/Gateway health when API_BASE_URL / REALTIME_BASE_URL are set

Writes .cache/ios-nemotron-services/mvp-status.json by default.
Use --strict to return a non-zero exit code when any gate is not ready.`);
}
