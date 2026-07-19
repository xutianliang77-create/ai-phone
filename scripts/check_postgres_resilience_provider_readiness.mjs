#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkPostgresResilienceProviderReadiness } from
  "./lib/postgres_resilience_provider_readiness.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const result = checkPostgresResilienceProviderReadiness({
  root,
  drillFile: valueFlag("--drill"),
  patroniFile: valueFlag("--patroni"),
  walgFile: valueFlag("--walg"),
});
if (args.length > 0) fail(`Unknown arguments: ${args.join(" ")}`);
console.log(JSON.stringify(result, null, 2));
if (result.status !== "ready") process.exitCode = 1;

function valueFlag(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) fail(`${flag} requires a value`);
  args.splice(index, 2);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
