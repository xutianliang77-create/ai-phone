#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  checkPostgresResilienceControllerConformance,
  simulatePostgresResilienceControllerFixture,
} from "./lib/postgres_resilience_controller_conformance.mjs";

const args = process.argv.slice(2);
const fixtureFile = valueFlag("--fixture");
if (args.length > 0) fail(`Unknown arguments: ${args.join(" ")}`);

let fixture = simulatePostgresResilienceControllerFixture();
if (fixtureFile) {
  try {
    fixture = JSON.parse(readFileSync(path.resolve(fixtureFile), "utf8"));
  } catch {
    fail("Controller conformance fixture is missing or invalid JSON");
  }
}
const result = checkPostgresResilienceControllerConformance(fixture);
console.log(JSON.stringify(result, null, 2));
if (result.status !== "passed") process.exitCode = 1;

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
