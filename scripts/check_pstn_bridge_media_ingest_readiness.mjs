#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkPstnBridgeMediaIngestReadiness } from "./lib/pstn_bridge_media_ingest_readiness.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const bridgePort = valueFlag("--bridge-port");
const sinkPort = valueFlag("--sink-port");
const timeoutMs = Number(valueFlag("--timeout-ms") ??
  process.env.PSTN_BRIDGE_MEDIA_INGEST_TIMEOUT_MS ??
  60000);
const output = path.resolve(
  root,
  valueFlag("--output") ?? ".cache/pstn-bridge-media-ingest-readiness.json",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...await checkPstnBridgeMediaIngestReadiness({
    root,
    bridgePort: bridgePort ? Number(bridgePort) : undefined,
    sinkPort: sinkPort ? Number(sinkPort) : undefined,
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
  console.log(`PSTN Bridge media ingest readiness passed: frame=${result.acceptedFrameId}`);
} else {
  console.error(`PSTN Bridge media ingest readiness failed: ${result.issues.join("; ")}`);
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
  scripts/check_pstn_bridge_media_ingest_readiness.mjs [--json]
  scripts/check_pstn_bridge_media_ingest_readiness.mjs --bridge-port 3422 --sink-port 3423

Starts an isolated @translation/pstn-bridge and a local audio frame sink.
Verifies:
- /media-frames rejects missing bridge API key
- /media-frames rejects invalid telephony audio payloads
- /media-frames converts mulaw8k frames to pcm16/16k
- audio frame sink receives normalized callId/mediaStreamId/sourceSpeakerRole frames`);
}
