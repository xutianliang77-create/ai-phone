#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadWalgBackupProviderConfig } from "./lib/walg_backup_provider_config.mjs";
import { runWalgBackupProviderStep } from "./lib/walg_backup_provider.mjs";
import { WalgBackupProviderRuntime } from "./lib/walg_backup_provider_runtime.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const step = args.shift();
const jsonIndex = args.indexOf("--json");
if (jsonIndex >= 0) args.splice(jsonIndex, 1);
if (!step || args.length > 0) fail("Usage: run_walg_backup_provider.mjs <step> --json");

try {
  const { config } = loadWalgBackupProviderConfig({ root });
  const runtime = new WalgBackupProviderRuntime(config);
  runtime.verifyExecutables();
  const result = await runWalgBackupProviderStep({
    config,
    runtime,
    root,
    runId: required("POSTGRES_RESILIENCE_RUN_ID"),
    step,
  });
  console.log(jsonIndex >= 0 ? JSON.stringify(result) : JSON.stringify(result, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
