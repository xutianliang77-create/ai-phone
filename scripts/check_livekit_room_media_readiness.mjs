#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkLiveKitRoomMediaReadiness } from "./lib/livekit_room_media_readiness.mjs";

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
const timeoutMs = Number(valueFlag("--timeout-ms") ??
  process.env.LIVEKIT_MEDIA_READINESS_TIMEOUT_MS ??
  15000);
const output = path.resolve(
  root,
  valueFlag("--output") ?? ".cache/livekit-room-media-readiness.json",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...await checkLiveKitRoomMediaReadiness({
    apiBaseUrl,
    internalApiSecret,
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
    `LiveKit room media readiness passed: callId=${result.callId}; room=${result.roomName}`,
  );
} else {
  console.error(`LiveKit room media readiness failed: ${result.issues.join("; ")}`);
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
  scripts/check_livekit_room_media_readiness.mjs --api-base-url http://127.0.0.1:3000
  scripts/check_livekit_room_media_readiness.mjs --internal-api-secret SECRET --json

Verifies real LiveKit media behavior against a running API:
- host, guest, and worker participants join one room
- host data packet reaches guest over the data channel
- guest publishes an audio track
- worker subscribes and reads the first user audio frame
- worker publishes a translation TTS audio track and guest reads the first translated audio frame`);
}
