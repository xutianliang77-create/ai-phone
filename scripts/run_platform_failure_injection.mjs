#!/usr/bin/env node
import process from "node:process";
import {
  runPlatformFailureInjection,
  validProfile,
} from "./lib/platform_failure_injection.mjs";
import { redactPhoneNumbers } from "./lib/phone_redaction.mjs";

const args = process.argv.slice(2);
if (takeFlag("--help") || takeFlag("-h")) {
  usage();
  process.exit(0);
}
if (args.length > 0) fail(`Unknown arguments: ${args.join(" ")}`);
if (required("PLATFORM_LOAD_ENVIRONMENT") !== "staging" ||
  required("PLATFORM_LOAD_MODE") !== "real") {
  fail("Platform failure injection requires real isolated staging context");
}
if (required("PLATFORM_LOAD_FAILURE_CONTROL_ACK") !==
  "WUJIE_STAGING_FAILURE_ONLY") {
  fail("PLATFORM_LOAD_FAILURE_CONTROL_ACK does not match the safety contract");
}
const controllerUrl = normalizedControllerUrl();
const token = required("PLATFORM_LOAD_FAILURE_TOKEN");
if (Buffer.byteLength(token) < 16) {
  fail("PLATFORM_LOAD_FAILURE_TOKEN must be at least 16 bytes");
}
const profile = {
  failureName: required("PLATFORM_LOAD_FAILURE"),
  target: required("PLATFORM_LOAD_FAILURE_TARGET"),
  fault: required("PLATFORM_LOAD_FAILURE_FAULT"),
};
if (!validProfile(profile.failureName, profile.target, profile.fault)) {
  fail("Failure target and fault do not match an approved profile");
}

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => controller.abort(new Error(`${signal} received`)));
}

try {
  const result = await runPlatformFailureInjection({
    ...profile,
    controllerUrl,
    token,
    runId: required("PLATFORM_LOAD_RUN_ID"),
    phase: required("PLATFORM_LOAD_PHASE"),
    targetConcurrency: boundedInteger(
      "PLATFORM_LOAD_TARGET_CONCURRENCY",
      1,
      10_000,
    ),
    recoveryTimeoutSeconds: boundedInteger(
      "PLATFORM_LOAD_RECOVERY_TIMEOUT_SECONDS",
      5,
      1800,
    ),
    requestTimeoutMs: boundedInteger(
      "PLATFORM_LOAD_FAILURE_REQUEST_TIMEOUT_MS",
      1000,
      30_000,
      10_000,
    ),
    statusPollMs: boundedInteger(
      "PLATFORM_LOAD_FAILURE_STATUS_POLL_MS",
      250,
      5_000,
      1_000,
    ),
    signal: controller.signal,
  });
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  fail(redactPhoneNumbers(error instanceof Error ? error.message : String(error)));
}

function normalizedControllerUrl() {
  const value = required("PLATFORM_LOAD_FAILURE_CONTROL_URL");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("PLATFORM_LOAD_FAILURE_CONTROL_URL must be a valid URL");
  }
  if (url.protocol !== "https:") fail("Failure controller requires HTTPS");
  if (url.username || url.password || url.search || url.hash) {
    fail("Failure controller URL must not contain credentials, query, or fragment");
  }
  const allowed = required("PLATFORM_LOAD_FAILURE_ALLOWED_HOSTS").split(",")
    .map((item) => item.trim()).filter(Boolean);
  if (!allowed.includes(url.hostname)) fail("Failure controller hostname is not allowlisted");
  return url.toString().replace(/\/?$/, "/");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required`);
  return value;
}

function boundedInteger(name, minimum, maximum, fallback) {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
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
  node scripts/run_platform_failure_injection.mjs

Calls only an allowlisted HTTPS staging failure controller. The controller must
auto-recover every injected fault even if this client exits unexpectedly.\n`);
}
