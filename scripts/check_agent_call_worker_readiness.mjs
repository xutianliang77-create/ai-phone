#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkAgentCallWorkerReadiness } from "./lib/agent_call_worker_readiness.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const apiPort = valueFlag("--api-port");
const bridgePort = valueFlag("--bridge-port");
const timeoutMs = Number(valueFlag("--timeout-ms") ??
  process.env.AGENT_CALL_WORKER_READINESS_TIMEOUT_MS ??
  60000);
const output = path.resolve(
  root,
  valueFlag("--output") ?? ".cache/agent-call-worker-readiness.json",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...await checkAgentCallWorkerReadiness({
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
  console.log(
    `Agent Call Worker readiness passed: draftId=${result.draftId}; callId=${result.callId}; providerCallId=${result.providerCallId}`,
  );
} else {
  console.error(`Agent Call Worker readiness failed: ${result.issues.join("; ")}`);
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
  scripts/check_agent_call_worker_readiness.mjs [--json]
  scripts/check_agent_call_worker_readiness.mjs --api-port 3420 --bridge-port 3422

Starts an isolated local API server, @translation/pstn-bridge, and real Agent Call Worker.
Verifies:
- AI Calling Agent draft creation, authorization, and queued start
- internal queued route rejects unauthenticated requests
- Worker dispatches queued drafts to PSTN_BRIDGE_BASE_URL/agent-calls
- PSTN Bridge accepts the task and Worker writes in_progress status back to API
- signed PSTN completion webhook updates the API draft and settles usage
- insufficient remaining balance blocks a second call before queueing`);
}
