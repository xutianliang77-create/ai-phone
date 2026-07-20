#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createSignedPenetrationEvidence,
  sha256,
  stableJson,
  validatePenetrationPlan,
} from "./lib/enterprise_security_penetration.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const planFile = valueFlag("--plan");
const outputFile = valueFlag("--output");
if (!planFile || !outputFile || !process.argv.includes("--acknowledge-isolated-target")) {
  fail("Usage: --plan=<file> --output=<file> --acknowledge-isolated-target");
}
if (gitStatus()) fail("Penetration evidence requires a clean candidate worktree");
const policy = readJson(path.join(root, "infra/enterprise-security/security-gate-policy.json"));
const plan = readJson(runtimePath(planFile));
const allowedHosts = csv(process.env.ENTERPRISE_SECURITY_ALLOWED_HOSTS);
const validation = validatePenetrationPlan(plan, policy, allowedHosts);
if (validation.issues.length > 0) fail(validation.issues.join("; "));
const commitSha = gitHead();
if (plan.commitSha !== commitSha) fail("Plan commitSha differs from the checked-out candidate");
const signingKey = process.env.ENTERPRISE_SECURITY_EVIDENCE_SIGNING_KEY;
const startedAt = new Date().toISOString();
const caseResults = [];
for (const item of plan.cases) caseResults.push(await runCase(item, validation.target.origin));
const findings = caseResults.filter((item) => item.status !== "pass").map((item) => ({
  caseId: item.id,
  severity: "P1",
  code: "negative_security_expectation_failed",
}));
const unsigned = {
  schemaVersion: 1,
  gate: "enterprise_penetration",
  status: findings.length === 0 ? "pass" : "not_ready",
  commitSha,
  target: {
    environment: validation.target.environment,
    origin: validation.target.origin,
  },
  runner: { name: "wujie-enterprise-negative-http", version: 1 },
  planHash: sha256(stableJson(plan)),
  startedAt,
  completedAt: new Date().toISOString(),
  cases: caseResults,
  findings,
};
const evidence = createSignedPenetrationEvidence(unsigned, signingKey);
const targetFile = runtimePath(outputFile);
if (existsSync(targetFile)) fail("Penetration evidence output already exists");
mkdirSync(path.dirname(targetFile), { recursive: true });
writeFileSync(targetFile, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  status: evidence.status,
  commitSha,
  outputFile: path.relative(root, targetFile),
  cases: caseResults.length,
  findings: findings.length,
}, null, 2));
if (evidence.status !== "pass") process.exit(1);

async function runCase(item, origin) {
  const repeat = item.repeat ?? 1;
  const attempts = [];
  for (let index = 0; index < repeat; index += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const started = Date.now();
    try {
      const targetUrl = new URL(item.path, origin);
      if (targetUrl.origin !== origin) throw new Error("target_origin_changed");
      const response = await fetch(targetUrl, {
        method: item.method,
        headers: requestHeaders(item),
        body: requestBody(item),
        redirect: "manual",
        signal: controller.signal,
      });
      const body = await response.text();
      const forbidden = (item.forbiddenResponseSubstrings ?? [])
        .some((value) => body.includes(value));
      const required = (item.requiredResponseSubstrings ?? [])
        .every((value) => body.includes(value));
      const status = item.allowedStatuses.includes(response.status) && !forbidden && required
        ? "pass" : "fail";
      attempts.push({
        status,
        httpStatus: response.status,
        responseBytes: Buffer.byteLength(body),
        responseSha256: sha256(body),
        durationMs: Date.now() - started,
      });
    } catch (error) {
      attempts.push({
        status: "fail",
        errorCode: error?.name === "AbortError" ? "timeout" : "transport_error",
        durationMs: Date.now() - started,
      });
    } finally { clearTimeout(timeout); }
  }
  return {
    id: item.id,
    category: item.category,
    status: attempts.every((attempt) => attempt.status === "pass") ? "pass" : "fail",
    attempts,
  };
}

function requestHeaders(item) {
  const headers = { ...(item.headers ?? {}) };
  for (const [name, env] of Object.entries(item.headerEnvs ?? {})) {
    if (!process.env[env]) fail(`Missing required penetration environment variable: ${env}`);
    headers[name] = process.env[env];
  }
  if (item.authEnv) {
    if (!process.env[item.authEnv]) fail(`Missing required penetration environment variable: ${item.authEnv}`);
    headers.authorization = `Bearer ${process.env[item.authEnv]}`;
  }
  return headers;
}

function requestBody(item) {
  if (item.bodyRepeat) {
    return JSON.stringify({ [item.bodyRepeat.field]: item.bodyRepeat.character.repeat(item.bodyRepeat.count) });
  }
  return item.body === undefined ? undefined : JSON.stringify(item.body);
}

function valueFlag(name) {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
function readJson(file) { return JSON.parse(readFileSync(file, "utf8")); }
function csv(value) { return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean); }
function gitHead() { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); }
function gitStatus() {
  return execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
}
function runtimePath(value) {
  const runtimeRoot = path.join(root, "tmp", "enterprise-security");
  const resolved = path.resolve(root, value);
  if (resolved !== runtimeRoot && !resolved.startsWith(`${runtimeRoot}${path.sep}`)) {
    fail("Penetration plan and evidence must stay under tmp/enterprise-security");
  }
  return resolved;
}
function fail(message) { console.error(message); process.exit(1); }
