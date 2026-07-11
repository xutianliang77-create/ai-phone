#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  evaluateModelFixture,
  loadModelEvalFixture,
} from "./lib/model_eval_runner.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const fixturePath = path.resolve(
  root,
  valueFlag("--fixture") ?? "model-eval/fixtures/cn-en-smoke.json",
);
const outputPath = path.resolve(
  root,
  valueFlag("--output") ?? ".cache/model-eval/latest.json",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  fixture: path.relative(root, fixturePath),
  ...evaluateModelFixture(loadModelEvalFixture(fixturePath)),
};

if (!noSave) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Model eval ${result.status}: ${result.fixture}`);
  for (const item of result.summary) {
    console.log(`${item.providerModel}: ${item.pass}/${item.total} pass`);
  }
  for (const issue of result.issues) console.error(`issue: ${issue}`);
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
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  args.splice(index, 2);
  return value;
}

function usage() {
  console.log(`Usage:
  scripts/run_model_eval.mjs [--json]
  scripts/run_model_eval.mjs --fixture model-eval/fixtures/cn-en-smoke.json
  scripts/run_model_eval.mjs --output .cache/model-eval/latest.json

Scores captured ASR, translation and TTS outputs with common metrics so model
POCs can be compared before replacing the current mobile ASR path.`);
}
