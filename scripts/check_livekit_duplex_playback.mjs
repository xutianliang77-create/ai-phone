#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkLiveKitDuplexPlayback } from "./lib/livekit_duplex_playback_probe.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const help = takeFlag("--help") || takeFlag("-h");
const apiBaseUrl = valueFlag("--api-base-url") ??
  process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
const internalApiSecret = valueFlag("--internal-api-secret") ??
  process.env.INTERNAL_API_SECRET;
const timeoutMs = Number(valueFlag("--timeout-ms") ?? 20000);
const output = path.resolve(
  root,
  valueFlag("--output") ?? ".cache/livekit-duplex-playback.json",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}
if (!internalApiSecret) throw new Error("INTERNAL_API_SECRET is required");

const result = {
  generatedAt: new Date().toISOString(),
  ...await checkLiveKitDuplexPlayback({
    apiBaseUrl,
    internalApiSecret,
    timeoutMs,
  }),
};

if (!noSave) {
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

if (json) console.log(JSON.stringify(result, null, 2));
else if (result.status === "ready") {
  console.log(`LiveKit duplex playback passed: callId=${result.callId}`);
} else {
  console.error(`LiveKit duplex playback failed: ${result.issues.join("; ")}`);
  for (const check of result.checks) {
    console.error(`${check.status}: ${check.name}`);
  }
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
  scripts/check_livekit_duplex_playback.mjs --api-base-url http://127.0.0.1:3000

Runs the production LiveKit TTS sink against a real room and verifies:
- host and guest playback legs run concurrently
- cancelling the guest target leg does not clear the host target leg
- a cancelled generation emits no frames after the replacement generation starts`);
}
