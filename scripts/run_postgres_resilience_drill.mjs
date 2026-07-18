#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { BoundedJsonCommandRunner } from "./lib/bounded_json_command_runner.mjs";
import { checkPlatformCapacityResult } from "./lib/platform_capacity_result.mjs";
import { checkPlatformTopology } from "./lib/platform_topology_config.mjs";
import { runPostgresResilienceDrill } from "./lib/postgres_resilience_drill.mjs";
import { loadPostgresResilienceDrillConfig } from
  "./lib/postgres_resilience_drill_config.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const configFile = valueFlag("--config") ??
  "infra/postgres/production-resilience/drill.json";
const runId = valueFlag("--run-id") ?? generatedRunId();
const outputOption = valueFlag("--output-directory") ??
  `outputs/postgres-resilience/${runId}`;
const promoteLatest = takeFlag("--promote-latest");
const json = takeFlag("--json");
const help = takeFlag("--help") || takeFlag("-h");

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const checked = loadPostgresResilienceDrillConfig({ root, file: configFile });
if (checked.status !== "ready") fail(checked.issues.join("; "));
const config = checked.config;
const topologyFile = path.resolve(root, config.topologyFile);
const capacityFile = path.resolve(root, config.capacityResultFile);
const topology = checkPlatformTopology({ root, file: topologyFile, release: true });
if (topology.status !== "ready") fail(topology.issues.join("; "));
const capacity = checkPlatformCapacityResult({
  root,
  file: capacityFile,
  topology: topologyFile,
});
if (capacity.status !== "ready") fail(capacity.issues.join("; "));
const outputDirectory = repositoryDirectory(root, outputOption);
mkdirSync(outputDirectory, { recursive: true });
const eventFile = path.join(outputDirectory, "events.jsonl");
const detailFile = path.join(outputDirectory, "run-details.json");
const resultFile = path.join(outputDirectory, "resilience-result.json");
writeFileSync(eventFile, "");
const abortController = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => abortController.abort(new Error(`${signal} received`)));
}
const runner = new BoundedJsonCommandRunner({
  root,
  outputDirectory,
  gracefulDrainSeconds: config.safety.gracefulDrainSeconds,
});

try {
  const drill = await runPostgresResilienceDrill({
    config,
    runner,
    runId,
    signal: abortController.signal,
    topologySha256: sha256(topologyFile),
    capacityResultSha256: sha256(capacityFile),
    onEvent: (event) => appendFileSync(eventFile, `${JSON.stringify(event)}\n`),
  });
  writeJson(detailFile, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    configFile: path.relative(root, checked.file),
    topologyFile: path.relative(root, topologyFile),
    capacityResultFile: path.relative(root, capacityFile),
    issues: drill.issues,
    steps: drill.steps,
  });
  drill.result.evidence = evidenceFiles(root, outputDirectory, [eventFile, detailFile]);
  writeJson(resultFile, drill.result);
  if (promoteLatest) {
    if (drill.result.status !== "passed") fail("Only a passed drill may be promoted");
    copyFileSync(resultFile, path.join(root, "outputs/postgres-resilience/latest.json"));
  }
  if (json) console.log(JSON.stringify({ ...drill.result, resultFile }, null, 2));
  else console.log(`PostgreSQL resilience drill ${drill.result.status}: ${resultFile}`);
  if (drill.result.status !== "passed") process.exitCode = 1;
} catch (error) {
  await runner.shutdown().catch(() => undefined);
  fail(error instanceof Error ? error.message : String(error));
}

function evidenceFiles(repositoryRoot, directory, primary) {
  const commandDirectory = path.join(directory, "commands");
  const commands = readdirSync(commandDirectory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(commandDirectory, name));
  return [...primary, ...commands].map((file) => ({
    path: path.relative(repositoryRoot, file),
    sha256: sha256(file),
  }));
}

function repositoryDirectory(repositoryRoot, value) {
  const resolved = path.resolve(repositoryRoot, value);
  const relative = path.relative(repositoryRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("output-directory must be inside the repository");
  }
  return resolved;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

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
  if (!value || value.startsWith("-")) fail(`${flag} requires a value`);
  args.splice(index, 2);
  return value;
}

function generatedRunId() {
  return `pg-resilience-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  console.log(`Usage:
  node scripts/run_postgres_resilience_drill.mjs --config path/to/drill.json
  node scripts/run_postgres_resilience_drill.mjs --config path/to/drill.json --promote-latest

Requires a verified topology, a passed real mixed-load capacity result, and an
exact POSTGRES_RESILIENCE_STAGING_ACK. Provider commands run without a shell and
must emit one JSON attestation document on stdout.`);
}
