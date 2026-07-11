#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDomesticLocalStack } from "./lib/domestic_local_stack_check.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const apiPort = Number(valueFlag("--api-port") ?? process.env.DOMESTIC_LOCAL_API_PORT ?? 3410);
const gatewayPort = Number(
  valueFlag("--gateway-port") ?? process.env.DOMESTIC_LOCAL_GATEWAY_PORT ?? 3411,
);
const timeoutMs = Number(valueFlag("--timeout-ms") ?? 15_000);
const modelRoutingFile =
  valueFlag("--model-routing-file") ?? nonEmpty(process.env.MODEL_ROUTING_FILE);
const modelRoutingProfile =
  valueFlag("--model-routing-profile") ?? nonEmpty(process.env.MODEL_ROUTING_PROFILE);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...await checkDomesticLocalStack({
    root,
    apiPort,
    gatewayPort,
    timeoutMs,
    modelRoutingFile,
    modelRoutingProfile,
  }),
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log("Domestic local service stack routes are ready.");
  console.log(`API: ${result.apiBaseUrl}`);
  console.log(`Gateway: ${result.gatewayBaseUrl}`);
  for (const check of result.checks) console.log(`pass: ${check.name}`);
} else {
  console.error(`Domestic local service stack failed: ${result.issues.join("; ")}`);
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

function nonEmpty(value) {
  return value && value.trim() ? value : null;
}

function usage() {
  console.log(`Usage:
  scripts/check_domestic_local_stack.mjs [--json]
  scripts/check_domestic_local_stack.mjs --api-port 3410 --gateway-port 3411
  scripts/check_domestic_local_stack.mjs --model-routing-profile domestic_server_qwen3_hymt2_voxcpm2

Starts the current workspace API Server and Realtime Gateway on temporary local
ports, then verifies:
- /health identifies api-server and realtime-gateway
- /health/release-ready exists and returns a structured ready/not_ready payload
- API /models/routing exposes current ASR/translation/TTS model routing

This is a startup contract check. Real release credentials are still verified by
npm run check:domestic-release-ready.`);
}
