#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const [suiteArg, outputArg] = process.argv.slice(2);
if (!suiteArg) {
  console.error("Usage: run_speaker_service_suite.mjs suite.json [output-dir]");
  process.exit(2);
}
const suitePath = resolve(suiteArg);
const suiteDir = dirname(suitePath);
const outputDir = resolve(outputArg ?? `.cache/speaker-service-suite/${timestamp()}`);
const baseUrl = env("SPEAKER_BASE_URL", "http://100.110.127.117:8022");
const apiKey = process.env.SPEAKER_SERVICE_API_KEY?.trim();
const python = env("PYTHON", "python3");
const realtime = env("SPEAKER_SUITE_REALTIME", "false") === "true";
mkdirSync(outputDir, { recursive: true });

const suite = JSON.parse(readFileSync(suitePath, "utf8"));
const health = await fetchJson(`${baseUrl}/health`);
const cases = [];
for (const testCase of suite.cases) {
  const outputPath = resolve(outputDir, `${testCase.id}-prediction.json`);
  const args = [
    "scripts/stream_speaker_service_eval.py",
    "--base-url", baseUrl,
    "--audio", resolve(suiteDir, testCase.audio),
    "--output", outputPath,
    "--frame-ms", env("SPEAKER_SUITE_FRAME_MS", "1000"),
    "--max-speakers", "4",
  ];
  if (apiKey) args.push("--api-key", apiKey);
  if (realtime && testCase.purpose !== "stability_only") args.push("--realtime");
  run(python, args);
  const prediction = JSON.parse(readFileSync(outputPath, "utf8"));
  cases.push({ ...testCase, predicted: prediction.predicted });
}

const predictionsPath = resolve(outputDir, "predictions.json");
const reportPath = resolve(outputDir, "report.json");
writeFileSync(predictionsPath, `${JSON.stringify({
  ...suite,
  model: health.model,
  provider: health.provider,
  mode: health.mode,
  cases,
}, null, 2)}\n`);
const evaluationStatus = run(
  "node",
  ["scripts/run_speaker_diarization_suite_eval.mjs", predictionsPath, reportPath],
  true,
);
console.log(JSON.stringify({ outputDir, predictionsPath, reportPath }, null, 2));
if (evaluationStatus !== 0) process.exitCode = evaluationStatus;

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${await response.text()}`);
  return response.json();
}

function run(command, args, allowFailure = false) {
  const result = spawnSync(command, args, { cwd: resolve("."), stdio: "inherit" });
  const status = result.status ?? 1;
  if (status !== 0 && !allowFailure) process.exit(status);
  return status;
}

function env(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.]/g, "");
}
