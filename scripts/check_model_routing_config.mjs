#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkModelRoutingConfig } from "./lib/model_routing_config.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const file = path.resolve(
  root,
  valueFlag("--file") ??
    nonEmpty(process.env.MODEL_ROUTING_FILE) ??
    "release/domestic/model-routing.json",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...checkModelRoutingConfig(file),
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log(`Model routing config ready: ${result.filePath}`);
} else {
  console.error(`Model routing config not ready: ${result.issues.join("; ")}`);
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

function nonEmpty(value) {
  return value && value.trim() ? value : null;
}

function usage() {
  console.log(`Usage:
  scripts/check_model_routing_config.mjs --json
  scripts/check_model_routing_config.mjs --file release/domestic/model-routing.json

Validates the unified ASR, translation, and TTS model routing config.`);
}
