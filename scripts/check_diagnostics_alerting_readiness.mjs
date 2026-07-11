#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkDiagnosticsAlertingReadiness } from "./lib/diagnostics_alerting_readiness.mjs";
import { checkDiagnosticsAlertingReadinessOnLocalStack } from "./lib/diagnostics_alerting_local_stack.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const localStack = takeFlag("--local-stack");
const apiPort = valueFlag("--api-port");
const webhookFormat = valueFlag("--webhook-format") ??
  process.env.DIAGNOSTICS_ALERT_WEBHOOK_FORMAT ??
  "generic";
const apiBaseUrl = valueFlag("--api-base-url") ??
  process.env.API_BASE_URL ??
  "http://127.0.0.1:3100";
const diagnosticsAdminToken = valueFlag("--diagnostics-admin-token") ??
  process.env.DIAGNOSTICS_ADMIN_TOKEN;
const timeoutMs = Number(valueFlag("--timeout-ms") ??
  process.env.DIAGNOSTICS_ALERTING_READINESS_TIMEOUT_MS ??
  15000);
const output = path.resolve(
  root,
  valueFlag("--output") ?? ".cache/diagnostics-alerting-readiness.json",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...await (localStack ? checkDiagnosticsAlertingReadinessOnLocalStack : checkDiagnosticsAlertingReadiness)({
    root,
    apiBaseUrl,
    apiPort: apiPort ? Number(apiPort) : undefined,
    diagnosticsAdminToken,
    timeoutMs,
    webhookFormat,
  }),
};

if (!noSave) {
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log("Diagnostics alerting readiness passed.");
} else {
  console.error(`Diagnostics alerting readiness failed: ${result.issues.join("; ")}`);
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
  scripts/check_diagnostics_alerting_readiness.mjs [--json]
  scripts/check_diagnostics_alerting_readiness.mjs --local-stack --json
  scripts/check_diagnostics_alerting_readiness.mjs --local-stack --webhook-format feishu --json
  scripts/check_diagnostics_alerting_readiness.mjs --api-base-url http://127.0.0.1:3100
  scripts/check_diagnostics_alerting_readiness.mjs --diagnostics-admin-token TOKEN

Verifies the domestic diagnostics alerting release gate:
- API /health exposes configured diagnostics admin, on-call, and webhook state
- POST /diagnostics/app-errors/alert-test succeeds with status=sent
- the alert-test endpoint can deliver to the configured on-call robot/channel
- --local-stack starts an isolated API and mock alert webhook, then verifies the signed alert payload
- --webhook-format verifies generic, wecom, feishu, or dingtalk robot payloads`);
}
