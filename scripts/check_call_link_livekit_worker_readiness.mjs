#!/usr/bin/env node
import process from "node:process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCallLinkLiveKitWorkerReadiness } from "./lib/call_link_livekit_worker_readiness.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const apiBaseUrl = valueFlag("--api-base-url") ??
  process.env.API_BASE_URL ??
  "http://127.0.0.1:3000";
const internalApiSecret = valueFlag("--internal-api-secret") ??
  process.env.INTERNAL_API_SECRET;
const diagnosticsAdminToken = valueFlag("--diagnostics-admin-token") ??
  process.env.DIAGNOSTICS_ADMIN_TOKEN;
const timeoutMs = Number(valueFlag("--timeout-ms") ??
  process.env.CALL_LINK_READINESS_TIMEOUT_MS ??
  15000);
const output = path.resolve(
  root,
  valueFlag("--output") ?? ".cache/call-link-livekit-worker-readiness.json",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...await checkCallLinkLiveKitWorkerReadiness({
    apiBaseUrl,
    internalApiSecret,
    diagnosticsAdminToken,
    timeoutMs,
  }),
};

if (!noSave) {
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log(
    `Call Link LiveKit Worker readiness passed: callId=${result.callId}; room=${result.roomName}`,
  );
} else {
  console.error(`Call Link LiveKit Worker readiness failed: ${result.issues.join("; ")}`);
  for (const check of result.checks) {
    console.error(`${check.status === "pass" ? "pass" : "fail"}: ${check.name}`);
  }
  for (const action of result.actions) console.error(`action: ${action}`);
}

if (result.status !== "ready") process.exit(1);

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
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  args.splice(index, 2);
  return value;
}

function usage() {
  console.log(`Usage:
  scripts/check_call_link_livekit_worker_readiness.mjs [--json]
  scripts/check_call_link_livekit_worker_readiness.mjs --api-base-url http://127.0.0.1:3000
  scripts/check_call_link_livekit_worker_readiness.mjs --internal-api-secret SECRET --diagnostics-admin-token TOKEN

Verifies the domestic Call Link LiveKit Worker preflight:
- API LiveKit readiness
- host and guest room tokens
- worker-only internal room token
- worker token can subscribe and publish translated TTS audio
- @livekit/rtc-node audio subscribe/publish runtime availability
- smoke transcript, translation, tts.ready publication and call history persistence`);
}
