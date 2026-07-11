#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkPstnBridgeAudioReadiness } from "./lib/pstn_bridge_audio_readiness.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const bridgePort = valueFlag("--bridge-port");
const upstreamPort = valueFlag("--upstream-port");
const timeoutMs = Number(valueFlag("--timeout-ms") ??
  process.env.PSTN_BRIDGE_AUDIO_READINESS_TIMEOUT_MS ??
  60000);
const output = path.resolve(
  root,
  valueFlag("--output") ?? ".cache/pstn-bridge-audio-readiness.json",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...await checkPstnBridgeAudioReadiness({
    root,
    bridgePort: bridgePort ? Number(bridgePort) : undefined,
    upstreamPort: upstreamPort ? Number(upstreamPort) : undefined,
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
  console.log(`PSTN Bridge audio readiness passed: playback=${result.providerPlaybackId}`);
} else {
  console.error(`PSTN Bridge audio readiness failed: ${result.issues.join("; ")}`);
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
  scripts/check_pstn_bridge_audio_readiness.mjs [--json]
  scripts/check_pstn_bridge_audio_readiness.mjs --bridge-port 3422 --upstream-port 3423

Starts an isolated @translation/pstn-bridge and a local HTTP PSTN upstream.
Verifies:
- /translated-audio rejects missing bridge API key
- /translated-audio rejects invalid source/target speaker roles
- /agent-calls creates providerCallId/mediaStreamId routing
- /translated-audio accepts PCM16 TTS audio
- HTTP PSTN provider forwards translated audio, route ids, and telephonyAudio to upstream /translated-audio`);
}
