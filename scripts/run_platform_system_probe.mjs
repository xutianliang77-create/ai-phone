#!/usr/bin/env node
import process from "node:process";
import { samplePlatformSystemMetrics } from "./lib/platform_system_probe.mjs";

const args = process.argv.slice(2);
if (takeFlag("--help") || takeFlag("-h")) {
  usage();
  process.exit(0);
}
if (args.length > 0) fail(`Unknown arguments: ${args.join(" ")}`);
if (required("PLATFORM_LOAD_ENVIRONMENT") !== "staging" ||
  required("PLATFORM_LOAD_MODE") !== "real") {
  fail("Platform system probe requires real isolated staging context");
}
const prometheusUrl = required("PLATFORM_LOAD_PROMETHEUS_URL").replace(/\/$/, "");
assertAllowedUrl(prometheusUrl);

try {
  const result = await samplePlatformSystemMetrics({
    prometheusUrl,
    token: process.env.PLATFORM_LOAD_PROMETHEUS_TOKEN,
    timeoutMs: optionalInteger("PLATFORM_LOAD_METRICS_TIMEOUT_MS", 15_000),
    queries: {
      utilization: required("PLATFORM_LOAD_PROMQL_UTILIZATION"),
      oom: required("PLATFORM_LOAD_PROMQL_OOM_COUNT"),
      unboundedQueue: required("PLATFORM_LOAD_PROMQL_UNBOUNDED_QUEUE"),
    },
  });
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

function assertAllowedUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("PLATFORM_LOAD_PROMETHEUS_URL must be a valid URL");
  }
  if (url.protocol !== "https:") fail("Real platform metrics require HTTPS");
  const allowed = required("PLATFORM_LOAD_METRICS_ALLOWED_HOSTS").split(",")
    .map((item) => item.trim()).filter(Boolean);
  if (!allowed.includes(url.hostname)) fail("Prometheus hostname is not allowlisted");
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
  node scripts/run_platform_system_probe.mjs

Queries must be pre-aggregated PromQL expressions that each return exactly one
scalar. Credentials remain in PLATFORM_LOAD_PROMETHEUS_TOKEN.\n`);
}
