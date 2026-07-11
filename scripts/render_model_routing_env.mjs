#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderModelRoutingEnv } from "./lib/model_routing_config.mjs";

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
const profile = valueFlag("--profile") ?? nonEmpty(process.env.MODEL_ROUTING_PROFILE);
const group = valueFlag("--group");

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const rendered = renderModelRoutingEnv(file, profile, group);
if (json) {
  console.log(JSON.stringify(rendered, null, 2));
} else {
  console.log(`# profile=${rendered.profile}`);
  if (rendered.group) console.log(`# group=${rendered.group}`);
  console.log(rendered.lines.join("\n"));
}

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
  scripts/render_model_routing_env.mjs
  scripts/render_model_routing_env.mjs --profile domestic_server_qwen3_hymt2_voxcpm2
  scripts/render_model_routing_env.mjs --profile domestic_server_qwen3_hymt2_voxcpm2 --group gateway
  scripts/render_model_routing_env.mjs --json

Prints shell exports for the selected ASR, translation, and TTS model profile.`);
}
