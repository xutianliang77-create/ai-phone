#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkModelSelectionReadiness } from "./lib/model_selection_readiness.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const file = path.resolve(
  root,
  valueFlag("--file") ??
    process.env.MODEL_SELECTION_FILE ??
    "release/domestic/model-selection-report.json",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = checkModelSelectionReadiness(file);

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log(`Model selection readiness passed: ${file}`);
} else {
  console.error(`Model selection readiness failed: ${result.issues.join("; ")}`);
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
  scripts/check_model_selection_readiness.mjs [--json]
  scripts/check_model_selection_readiness.mjs --file release/domestic/model-selection-report.json

Blocks release until ASR, translation, and TTS model selection is backed by
ready model-eval evidence and licensing, cost, and deployment reviews.`);
}
