#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkPstnProviderMediaEventReadiness } from "./lib/pstn_provider_media_event_readiness.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const bridgePort = valueFlag("--bridge-port");
const sinkPort = valueFlag("--sink-port");
const timeoutMs = Number(valueFlag("--timeout-ms") ??
  process.env.PSTN_PROVIDER_MEDIA_EVENT_TIMEOUT_MS ??
  60000);
const output = path.resolve(
  root,
  valueFlag("--output") ?? ".cache/pstn-provider-media-event-readiness.json",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...await checkPstnProviderMediaEventReadiness({
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
  console.log(`PSTN provider media event readiness passed: frame=${result.acceptedFrameId}`);
} else {
  console.error(`PSTN provider media event readiness failed: ${result.issues.join("; ")}`);
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
  scripts/check_pstn_provider_media_event_readiness.mjs [--json]
  scripts/check_pstn_provider_media_event_readiness.mjs --bridge-port 3424 --sink-port 3425

Starts an isolated @translation/pstn-bridge and a local audio frame sink.
Verifies:
- /provider/media-events rejects unsigned provider callbacks
- /provider/media-events rejects invalid signed provider payloads
- signed provider media.frame callbacks are accepted
- callback audio is converted from mulaw8k to pcm16/16k and forwarded to the sink`);
}
