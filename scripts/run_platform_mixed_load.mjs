#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { PlatformMixedLoadCommandDriver } from
  "./lib/platform_mixed_load_command_driver.mjs";
import { loadPlatformMixedLoadConfig } from "./lib/platform_mixed_load_config.mjs";
import { runPlatformMixedLoad } from "./lib/platform_mixed_load_orchestrator.mjs";
import { checkPlatformTopology } from "./lib/platform_topology_config.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const configFile = valueFlag("--config") ?? "infra/platform-ha/mixed-load.json";
const runId = valueFlag("--run-id") ?? generatedRunId();
const outputOption = valueFlag("--output-directory") ??
  `outputs/platform-capacity/${runId}`;
const allowMock = takeFlag("--allow-mock");
const promoteLatest = takeFlag("--promote-latest");
const json = takeFlag("--json");
const help = takeFlag("--help") || takeFlag("-h");

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const checked = loadPlatformMixedLoadConfig({
  root,
  file: configFile,
  release: !allowMock,
});
if (checked.status !== "ready") fail(checked.issues.join("; "));
const config = checked.config;
if (config.mode === "mock" && !allowMock) fail("Mock mode requires --allow-mock");
const topologyFile = path.resolve(root, config.topologyFile);
const topology = checkPlatformTopology({
  root,
  file: topologyFile,
  release: config.mode === "real",
});
if (topology.status !== "ready") fail(topology.issues.join("; "));
const outputDirectory = repositoryDirectory(root, outputOption);
mkdirSync(outputDirectory, { recursive: true });
const eventFile = path.join(outputDirectory, "events.jsonl");
const detailFile = path.join(outputDirectory, "run-details.json");
const resultFile = path.join(outputDirectory, "capacity-result.json");
writeFileSync(eventFile, "");
const abortController = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => abortController.abort(new Error(`${signal} received`)));
}
const evidence = [eventFile, detailFile].map((file) => path.relative(root, file));
const driver = new PlatformMixedLoadCommandDriver({
  root,
  config,
  outputDirectory,
});

try {
  const run = await runPlatformMixedLoad({
    config,
    driver,
    runId,
    signal: abortController.signal,
    topologySha256: sha256(topologyFile),
    evidence,
    onEvent: (event) => appendFileSync(eventFile, `${JSON.stringify(event)}\n`),
  });
  writeJson(detailFile, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    configFile: path.relative(root, checked.file),
    topologyFile: path.relative(root, topologyFile),
    phases: run.phases,
  });
  writeJson(resultFile, run.result);
  if (promoteLatest) {
    if (run.result.status !== "passed") {
      fail("Only a passed real run may be promoted to latest.json");
    }
    copyFileSync(resultFile, path.join(root, "outputs/platform-capacity/latest.json"));
  }
  if (json) console.log(JSON.stringify({ ...run.result, resultFile }, null, 2));
  else console.log(`Mixed-load run ${run.result.status}: ${resultFile}`);
  if (!new Set(["passed", "mock_passed"]).has(run.result.status)) process.exitCode = 1;
} catch (error) {
  await driver.shutdown().catch(() => undefined);
  fail(error instanceof Error ? error.message : String(error));
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
  return `capacity-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  console.log(`Usage:
  node scripts/run_platform_mixed_load.mjs --config infra/platform-ha/mixed-load.json
  node scripts/run_platform_mixed_load.mjs --config path/to/mock.json --allow-mock

Real runs require a verified topology, MIXED_LOAD_STAGING_ACK, and an explicit
MIXED_LOAD_PSTN_ALLOWLIST. Commands are executed without a shell and each must
emit exactly one JSON attestation document on stdout.`);
}
