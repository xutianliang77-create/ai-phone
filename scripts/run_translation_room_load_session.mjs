#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runTranslationRoomLoadSession } from
  "./lib/translation_room_load_session.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
if (takeFlag("--help") || takeFlag("-h")) {
  usage();
  process.exit(0);
}
if (args.length > 0) fail(`Unknown arguments: ${args.join(" ")}`);

const apiBaseUrl = required("PLATFORM_LOAD_API_BASE_URL").replace(/\/$/, "");
const sessionId = required("PLATFORM_LOAD_SESSION_ID");
const durationMs = boundedInteger("PLATFORM_LOAD_DURATION_MS", 1000, 172_800_000);
const accountToken = required("PLATFORM_LOAD_ACCOUNT_TOKEN");
assertStagingUrl(apiBaseUrl);
if (required("PLATFORM_LOAD_ENVIRONMENT") !== "staging") {
  fail("Translation load sessions require PLATFORM_LOAD_ENVIRONMENT=staging");
}
if (required("PLATFORM_LOAD_MODE") !== "real") {
  fail("Translation load sessions require PLATFORM_LOAD_MODE=real");
}

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => controller.abort(new Error(`${signal} received`)));
}

try {
  const result = await runTranslationRoomLoadSession({
    root,
    apiBaseUrl,
    sessionId,
    durationMs,
    accountToken,
    signal: controller.signal,
    requestTimeoutMs: optionalInteger("PLATFORM_LOAD_REQUEST_TIMEOUT_MS", 20_000),
    eventTimeoutMs: optionalInteger("PLATFORM_LOAD_EVENT_TIMEOUT_MS", 30_000),
    utteranceIntervalMs: optionalInteger("PLATFORM_LOAD_UTTERANCE_INTERVAL_MS", 15_000),
    endpointSilenceMs: optionalInteger("PLATFORM_LOAD_ENDPOINT_SILENCE_MS", 1_200),
    zhFixture: process.env.PLATFORM_LOAD_ZH_AUDIO_FIXTURE,
    enFixture: process.env.PLATFORM_LOAD_EN_AUDIO_FIXTURE,
  });
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

function assertStagingUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("PLATFORM_LOAD_API_BASE_URL must be a valid URL");
  }
  if (url.protocol !== "https:") fail("Real translation load sessions require HTTPS");
  const allowed = required("PLATFORM_LOAD_API_ALLOWED_HOSTS").split(",")
    .map((item) => item.trim()).filter(Boolean);
  if (!allowed.includes(url.hostname)) {
    fail("Translation load API hostname is not explicitly allowlisted");
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required`);
  return value;
}

function optionalInteger(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) fail(`${name} must be a positive integer`);
  return parsed;
}

function boundedInteger(name, minimum, maximum) {
  const value = Number(required(name));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function usage() {
  process.stdout.write(`Usage:
  node scripts/run_translation_room_load_session.mjs

This command is launched by platform:mixed-load and reads its bounded staging
context from PLATFORM_LOAD_* environment variables. It never accepts a
production endpoint and emits exactly one JSON attestation on stdout.\n`);
}
