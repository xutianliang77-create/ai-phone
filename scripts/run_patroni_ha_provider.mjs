#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadPatroniHaProviderConfig } from
  "./lib/patroni_ha_provider_config.mjs";
import { runPatroniHaProviderStep } from "./lib/patroni_ha_provider.mjs";
import { PatroniHaProviderRuntime } from
  "./lib/patroni_ha_provider_runtime.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const step = args.shift();
const json = takeFlag("--json");
if (!step || args.length > 0) fail("Usage: run_patroni_ha_provider.mjs <step> --json");

try {
  const { config } = loadPatroniHaProviderConfig({ root });
  const runtime = new PatroniHaProviderRuntime(config);
  runtime.verifyExecutables();
  const result = await runPatroniHaProviderStep({
    config,
    runtime,
    root,
    runId: required("POSTGRES_RESILIENCE_RUN_ID"),
    step,
  });
  if (json) console.log(JSON.stringify(result));
  else console.log(JSON.stringify(result, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
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
