#!/usr/bin/env node
import process from "node:process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkLmStudioTranslation } from "./lib/lmstudio_translation_smoke.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const output = path.resolve(
  root,
  valueFlag("--output") ?? ".cache/ios-nemotron-services/translation-provider.json",
);
const provider = valueFlag("--provider") ??
  process.env.TRANSLATION_PROVIDER ??
  "lmstudio";
const baseUrl = valueFlag("--base-url") ??
  process.env.TRANSLATION_BASE_URL ??
  process.env.LMSTUDIO_BASE_URL ??
  "http://222.128.62.139:1234/v1";
const model = valueFlag("--model") ??
  process.env.TRANSLATION_MODEL ??
  process.env.LMSTUDIO_MODEL ??
  "tencent/Hy-MT2-1.8B";
const text = valueFlag("--text") ??
  process.env.LMSTUDIO_SMOKE_TEXT ??
  "hello, this is a realtime translation test";
const timeoutMs = Number(valueFlag("--timeout-ms") ??
  process.env.LMSTUDIO_TIMEOUT_MS ??
  60000);
const maxTokens = Number(valueFlag("--max-tokens") ??
  process.env.LMSTUDIO_MAX_TOKENS ??
  128);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...await checkLmStudioTranslation({
  baseUrl,
  model,
  apiKey: process.env.TRANSLATION_API_KEY ?? process.env.LMSTUDIO_API_KEY,
  timeoutMs,
  maxTokens,
  text,
  reasoningEffort: provider === "hymt2_self_hosted" ? null : "none",
  }),
};

if (!noSave) {
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log(
    `Translation provider ready: provider=${provider}; model=${result.model}; latency=${result.latencyMs}ms; translation=${result.translation}`,
  );
} else {
  console.error(`Translation provider not ready: ${result.issues.join("; ")}`);
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
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  args.splice(index, 2);
  return value;
}

function usage() {
  console.log(`Usage:
  scripts/check_lmstudio_translation_provider.mjs [--json]
  scripts/check_lmstudio_translation_provider.mjs [--provider hymt2_self_hosted]
  scripts/check_lmstudio_translation_provider.mjs [--base-url URL] [--model ID]
  scripts/check_lmstudio_translation_provider.mjs [--output PATH] [--no-save]

Verifies the OpenAI-compatible translation model used by Gateway/Worker.
Reads TRANSLATION_* first and keeps LMSTUDIO_* compatibility for local iPhone smoke.`);
}
