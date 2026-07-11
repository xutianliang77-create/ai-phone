#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkPstnProviderStatusEventReadiness } from "./lib/pstn_provider_status_event_readiness.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const apiPort = valueFlag("--api-port");
const bridgePort = valueFlag("--bridge-port");
const timeoutMs = Number(valueFlag("--timeout-ms") ?? 60000);
const output = path.resolve(
  root,
  valueFlag("--output") ?? ".cache/pstn-provider-status-event-readiness.json",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...await checkPstnProviderStatusEventReadiness({
    root,
    apiPort: apiPort ? Number(apiPort) : undefined,
    bridgePort: bridgePort ? Number(bridgePort) : undefined,
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
  console.log(`PSTN provider status event readiness passed: call=${result.callId}`);
} else {
  console.error(`PSTN provider status event readiness failed: ${result.issues.join("; ")}`);
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
  scripts/check_pstn_provider_status_event_readiness.mjs [--json]

Starts an isolated API server and PSTN Bridge.
Verifies:
- provider status callbacks require HMAC signatures
- invalid signed provider status payloads are rejected
- answered callbacks update the AI Calling Agent draft to in_progress
- completed callbacks update the draft to completed through the API PSTN webhook`);
}
