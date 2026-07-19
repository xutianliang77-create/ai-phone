#!/usr/bin/env node
import process from "node:process";
import { runAgentEgressLoadSession } from "./lib/agent_egress_load_session.mjs";
import { redactPhoneNumbers } from "./lib/phone_redaction.mjs";

const args = process.argv.slice(2);
if (takeFlag("--help") || takeFlag("-h")) {
  usage();
  process.exit(0);
}
if (args.length > 0) fail(`Unknown arguments: ${args.join(" ")}`);

const apiBaseUrl = required("PLATFORM_LOAD_API_BASE_URL").replace(/\/$/, "");
const sessionId = required("PLATFORM_LOAD_SESSION_ID");
const allowedPhones = phoneAllowlist();
const targetPhone = choosePhone(allowedPhones, sessionId);
const requestTimeoutMs = optionalInteger("PLATFORM_LOAD_REQUEST_TIMEOUT_MS", 10_000);
const artifactTimeoutMs = optionalInteger(
  "PLATFORM_LOAD_EGRESS_ARTIFACT_TIMEOUT_MS",
  90_000,
);
const gracefulDrainMs = boundedInteger(
  "PLATFORM_LOAD_GRACEFUL_DRAIN_SECONDS",
  5,
  300,
) * 1000;
assertStagingUrl(apiBaseUrl);
if (required("PLATFORM_LOAD_ENVIRONMENT") !== "staging") {
  fail("Agent Egress load sessions require PLATFORM_LOAD_ENVIRONMENT=staging");
}
if (required("PLATFORM_LOAD_MODE") !== "real") {
  fail("Agent Egress load sessions require PLATFORM_LOAD_MODE=real");
}
if (requestTimeoutMs * 2 + artifactTimeoutMs > gracefulDrainMs) {
  fail("Agent Egress request and artifact timeouts exceed graceful drain");
}

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => controller.abort(new Error(`${signal} received`)));
}

try {
  const result = await runAgentEgressLoadSession({
    apiBaseUrl,
    sessionId,
    targetPhone,
    language: optionalLanguage(),
    durationMs: boundedInteger("PLATFORM_LOAD_DURATION_MS", 1000, 172_800_000),
    accountToken: required("PLATFORM_LOAD_ACCOUNT_TOKEN"),
    consentPromptVersion: required("PLATFORM_LOAD_AGENT_CONSENT_PROMPT_VERSION"),
    disclosurePromptVersion: required(
      "PLATFORM_LOAD_AGENT_DISCLOSURE_PROMPT_VERSION",
    ),
    recordingPolicyVersion: required(
      "PLATFORM_LOAD_AGENT_RECORDING_POLICY_VERSION",
    ),
    signal: controller.signal,
    requestTimeoutMs,
    statusPollMs: optionalInteger("PLATFORM_LOAD_AGENT_STATUS_POLL_MS", 1_000),
    agentStartTimeoutMs: optionalInteger(
      "PLATFORM_LOAD_AGENT_START_TIMEOUT_MS",
      90_000,
    ),
    consentTimeoutMs: optionalInteger(
      "PLATFORM_LOAD_AGENT_CONSENT_TIMEOUT_MS",
      90_000,
    ),
    egressStartTimeoutMs: optionalInteger(
      "PLATFORM_LOAD_EGRESS_START_TIMEOUT_MS",
      30_000,
    ),
    artifactTimeoutMs,
  });
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  fail(redactPhoneNumbers(
    error instanceof Error ? error.message : String(error),
    targetPhone,
  ));
}

function phoneAllowlist() {
  const values = required("MIXED_LOAD_PSTN_ALLOWLIST").split(",")
    .map((item) => item.trim()).filter(Boolean);
  if (values.length === 0 || values.some((item) => !/^\+[1-9]\d{7,14}$/.test(item))) {
    fail("MIXED_LOAD_PSTN_ALLOWLIST must contain only explicit E.164 staging numbers");
  }
  return [...new Set(values)];
}

function choosePhone(values, sessionId) {
  const checksum = [...sessionId].reduce((sum, item) => sum + item.charCodeAt(0), 0);
  return values[checksum % values.length];
}

function assertStagingUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("PLATFORM_LOAD_API_BASE_URL must be a valid URL");
  }
  if (url.protocol !== "https:") fail("Real Agent Egress load sessions require HTTPS");
  const allowed = required("PLATFORM_LOAD_API_ALLOWED_HOSTS").split(",")
    .map((item) => item.trim()).filter(Boolean);
  if (!allowed.includes(url.hostname)) fail("Agent Egress load API hostname is not allowlisted");
}

function optionalLanguage() {
  const value = process.env.PLATFORM_LOAD_AGENT_LANGUAGE?.trim() || "zh";
  if (!["zh", "en"].includes(value)) {
    fail("PLATFORM_LOAD_AGENT_LANGUAGE must be zh or en");
  }
  return value;
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
  node scripts/run_agent_egress_load_session.mjs

Runs only against an allowlisted owned staging auto-answer endpoint. The callee
must explicitly consent before Egress starts; the selected number is never printed.\n`);
}
