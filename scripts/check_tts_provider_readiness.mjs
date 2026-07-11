#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkTtsProviderReadiness } from "./lib/tts_provider_readiness.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const allowMissingApiKey = takeFlag("--allow-missing-api-key");
const endpoint = valueFlagFromEnv("endpoint", "TTS_HTTP_ENDPOINT");
const apiKey = valueFlagFromEnv("api-key", "TTS_HTTP_API_KEY");
const provider = valueFlagFromEnv("provider", "TTS_PROVIDER") || "voxcpm2";
const model = valueFlagFromEnv("model", "TTS_MODEL") || "VoxCPM2";
const timeoutMs = Number(valueFlagFromEnv("timeout-ms", "TTS_HTTP_TIMEOUT_MS") || 5000);
const maxFirstAudioMs = Number(
  valueFlagFromEnv("max-first-audio-ms", "TTS_MAX_FIRST_AUDIO_MS") || 1000,
);
const output = path.resolve(
  root,
  valueFlag("--output") ?? ".cache/tts-provider-readiness.json",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...await checkTtsProviderReadiness({
    endpoint,
    apiKey,
    provider,
    model,
    timeoutMs,
    maxFirstAudioMs,
    requireApiKey: !allowMissingApiKey,
  }),
};

if (!noSave) {
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log(`TTS provider readiness passed: ${result.provider}/${result.model}`);
} else {
  console.error(`TTS provider readiness failed: ${result.issues.join("; ")}`);
  for (const check of result.checks) {
    console.error(`${check.status === "pass" ? "pass" : "fail"}: ${check.name}`);
  }
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

function valueFlagFromEnv(name, envKey) {
  return valueFlag(`--${name}`) ?? process.env[envKey] ?? "";
}

function usage() {
  console.log(`Usage:
  scripts/check_tts_provider_readiness.mjs --json
  scripts/check_tts_provider_readiness.mjs --endpoint https://tts.example.cn/voxcpm2/synthesize --api-key xxx
  scripts/check_tts_provider_readiness.mjs --allow-missing-api-key

Verifies the domestic call TTS provider contract:
- TTS_HTTP_ENDPOINT is configured
- TTS_HTTP_API_KEY is real unless --allow-missing-api-key is passed
- service returns provider=voxcpm2 and model=VoxCPM2
- service returns playable base64 PCM16 audio at 16kHz or 24kHz
- firstAudioMs is present and within the release latency threshold`);
}
