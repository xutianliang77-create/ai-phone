#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkPostgresProductionResilience } from
  "./lib/postgres_production_resilience.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const file = valueFlag("--file");
const topology = valueFlag("--topology");
const capacity = valueFlag("--capacity");
const json = takeFlag("--json");
if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);
const result = checkPostgresProductionResilience({ root, file, topology, capacity });
if (json) console.log(JSON.stringify(result, null, 2));
else if (result.status === "ready") {
  console.log(`PostgreSQL production resilience ready: ${result.file}`);
} else {
  console.error(`PostgreSQL production resilience not ready: ${result.issues.join("; ")}`);
}
if (result.status !== "ready") process.exit(1);

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function valueFlag(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  args.splice(index, 2);
  return value;
}
