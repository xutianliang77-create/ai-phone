#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkLiveKitSelfHostConfig } from "./lib/livekit_selfhost_config.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const envFile = valueFlag("--env") ?? process.env.LIVEKIT_SELFHOST_ENV_FILE;

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...checkLiveKitSelfHostConfig({ root, envFile }),
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log(`LiveKit self-host config readiness passed: ${result.releaseSnippet}`);
} else {
  console.error(`LiveKit self-host config readiness failed: ${result.issues.join("; ")}`);
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
  scripts/check_livekit_selfhost_config.mjs --env infra/livekit-selfhost/.env --json

Verifies the self-hosted LiveKit VM configuration before rendering deployment
files:
- primary and TURN domains are public and distinct
- API key and secret are real production values
- HTTP, RTC TCP, RTC UDP range, and TURN UDP ports are valid
- optional TURN/TLS settings include certificate and key paths`);
}
