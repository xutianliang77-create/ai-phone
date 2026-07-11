#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkDomesticPaymentCallbacksReadiness } from "./lib/domestic_payment_callbacks_readiness.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const apiPort = valueFlag("--api-port");
const timeoutMs = Number(valueFlag("--timeout-ms") ??
  process.env.DOMESTIC_PAYMENT_CALLBACKS_TIMEOUT_MS ??
  60000);
const output = path.resolve(
  root,
  valueFlag("--output") ?? ".cache/domestic-payment-callbacks-readiness.json",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...await checkDomesticPaymentCallbacksReadiness({
    root,
    apiPort: apiPort ? Number(apiPort) : undefined,
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
  console.log("Domestic payment callback readiness passed.");
} else {
  console.error(`Domestic payment callback readiness failed: ${result.issues.join("; ")}`);
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
  scripts/check_domestic_payment_callbacks_readiness.mjs [--json]
  scripts/check_domestic_payment_callbacks_readiness.mjs --api-port 3424

Starts an isolated API server with local domestic payment provider settings.
Verifies:
- WeChat order creation, signed SUCCESS callback, duplicate handling, and invalid signature rejection
- Alipay order creation and signed TRADE_SUCCESS callback
- usage balance and billing ledger updates from signed callbacks`);
}
