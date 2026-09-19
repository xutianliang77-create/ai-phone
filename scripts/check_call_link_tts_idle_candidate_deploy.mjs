#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnvFile } from "./lib/domestic_release_env_file_check.mjs";

const reservedPorts = new Set([
  3110, 3111, 3210, 3211, 8081, 8082, 3310,
  18000, 18002, 18003, 18004, 18081, 18084, 18100,
  18788, 18789, 18883, 18884, 18887,
]);
const modelEndpointKeys = [
  "ASR_HTTP_ENDPOINT",
  "ASR_HTTP_FLUSH_ENDPOINT",
  "ASR_STREAM_ENDPOINT",
  "ASR_HTTP_HEALTH_URL",
  "TRANSLATION_BASE_URL",
  "TTS_HTTP_ENDPOINT",
  "TTS_STREAM_ENDPOINT",
  "TTS_WARMUP_ENDPOINT",
  "LLM_BASE_URL",
  "QWEN_BASE_URL",
  "MODEL_ROUTING_FILE",
];

const args = process.argv.slice(2);
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (args.includes("--help")) {
    console.log(`Usage:
  node scripts/check_call_link_tts_idle_candidate_deploy.mjs \\
    --env-file /private/call-link-tts-idle.env \\
    --compose-project wujie-v11-calllinktts-test \\
    --container-prefix wujie-v11-calllinktts-test \\
    --remote-root /data/models/ai-phone-server-candidates/wujie-v11-calllinktts-test \\
    --api-port 13410 --realtime-port 13411 --translation-agent-port 13412

This check is for a no-provider, shared-host deployment smoke candidate only.
It rejects configured private/public model endpoints and cannot authorize a
Call Link room or Worker. It is not a release or real-model qualification gate.`);
    process.exit(0);
  }
  const result = checkCallLinkTtsIdleCandidateDeploy({
    root: process.cwd(),
    envFile: value("--env-file") ?? process.env.CANDIDATE_ENV_FILE,
    composeProject: value("--compose-project") ?? process.env.COMPOSE_PROJECT_NAME,
    containerPrefix: value("--container-prefix") ?? process.env.AI_PHONE_CONTAINER_PREFIX,
    remoteRoot: value("--remote-root") ?? process.env.REMOTE_ROOT,
    apiPort: value("--api-port") ?? process.env.API_PORT,
    realtimePort: value("--realtime-port") ?? process.env.REALTIME_PORT,
    translationAgentPort: value("--translation-agent-port") ?? process.env.LIVEKIT_AGENT_PORT,
  });
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else if (result.status === "ready_for_idle_deployment") {
    console.log("Call Link Tencent TTS idle deployment preflight passed.");
  } else {
    console.error("Call Link Tencent TTS idle deployment preflight failed:");
    for (const issue of result.issues) console.error(`- ${issue}`);
  }
  if (result.status !== "ready_for_idle_deployment") process.exitCode = 1;
}

export function checkCallLinkTtsIdleCandidateDeploy(options = {}) {
  const envFile = resolve(options.root ?? root, options.envFile ?? "call-link-tts-idle.env");
  const checks = [];
  const issues = [];
  const env = loadProtectedEnv(envFile, checks, issues);
  const composeProject = options.composeProject ?? "wujie-v11-calllinktts-test";
  const containerPrefix = options.containerPrefix ?? composeProject;
  const remoteRoot = options.remoteRoot ??
    "/data/models/ai-phone-server-candidates/wujie-v11-calllinktts-test";
  const ports = {
    api: number(options.apiPort ?? 13410),
    realtime: number(options.realtimePort ?? 13411),
    translationAgent: number(options.translationAgentPort ?? 13412),
  };

  checkIdentity({ composeProject, containerPrefix, remoteRoot, ports }, checks, issues);
  checkIdleProfile(env, checks, issues);
  checkCompatibilityBinding(env, checks, issues);
  checkSecrets(env, checks, issues);
  checkNoModelEndpoints(env, checks, issues);

  return {
    status: issues.length === 0 ? "ready_for_idle_deployment" : "not_ready",
    envFile,
    composeProject,
    containerPrefix,
    remoteRoot,
    ports,
    checks,
    issues: [...new Set(issues)],
  };
}

function loadProtectedEnv(file, checks, issues) {
  const ok = protectedFile(file);
  record(checks, "candidate_env_file", ok, { path: file });
  if (!ok) {
    issues.push("idle candidate env file must be a regular 0600 file");
    return {};
  }
  return parseEnvFile(readFileSync(file, "utf8"));
}

function checkIdentity(input, checks, issues) {
  const name = (value) => /^[a-z0-9][a-z0-9_-]{2,62}$/.test(value) &&
    !["ai-phone", "wujie-ai"].includes(value);
  const namesOk = name(input.composeProject) && name(input.containerPrefix);
  record(checks, "isolated_names", namesOk, {
    composeProject: input.composeProject,
    containerPrefix: input.containerPrefix,
  });
  if (!namesOk) issues.push("idle candidate names must be isolated");
  const rootOk = /^\/[A-Za-z0-9._/-]+$/.test(input.remoteRoot) &&
    input.remoteRoot.includes("candidate") &&
    input.remoteRoot !== "/data/models/ai-phone-server";
  record(checks, "isolated_remote_root", rootOk, { remoteRoot: input.remoteRoot });
  if (!rootOk) issues.push("idle candidate remote root must be isolated");
  const values = Object.values(input.ports);
  const portsOk = values.every((value) => Number.isInteger(value) && value > 0 && value <= 65535) &&
    new Set(values).size === values.length &&
    values.every((value) => !reservedPorts.has(value));
  record(checks, "candidate_ports", portsOk, input.ports);
  if (!portsOk) issues.push("idle candidate ports must be unique and non-reserved");
}

function checkIdleProfile(env, checks, issues) {
  const expected = {
    CANDIDATE_DEPLOYMENT_PROFILE: "call_link_tts_idle_test",
    NODE_ENV: "development",
    DEPLOYMENT_ENVIRONMENT: "call-link-tts-idle-test",
    API_TEST_AUTO_ACCOUNT: "true",
    CALL_LINK_DEPLOYMENT_TEST_MODE: "true",
    CALL_LINK_PUBLIC_TTS_ENABLED: "true",
    PUBLIC_RUNTIME_ENABLED: "false",
    WUJIE_AI_TRANSLATION_AGENT_ENABLED: "true",
    WUJIE_AI_AGENT_CALL_WORKER_ENABLED: "false",
    WUJIE_AI_VOICE_AGENT_ENABLED: "false",
    WUJIE_AI_AIR_DEVICE_GATEWAY_ENABLED: "false",
    WUJIE_AI_SRT_INGRESS_ENABLED: "false",
    TRANSLATION_WORKER_RUNTIME_PROVIDER: "local_process",
    LLM_PROVIDER: "off",
    LLM_REFINEMENT_ENABLED: "false",
    LLM_REVIEW_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(expected)) {
    const ok = env[key] === value;
    record(checks, `idle_${key.toLowerCase()}`, ok, { configured: env[key] === value });
    if (!ok) issues.push(`idle candidate requires ${key}=${value}`);
  }
}

function checkCompatibilityBinding(env, checks, issues) {
  const deployment = env.API_RESULT_SYNC_DEPLOYMENT_ID ?? "";
  const ok = /^[A-Za-z0-9_-]{8,128}$/.test(deployment) &&
    env.CALL_LINK_1_0_COMPATIBILITY_ENABLED === "true" &&
    env.CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID === deployment &&
    env.CALL_LINK_1_0_COMPATIBILITY_PROFILE === "call_link_only" &&
    env.CALL_PROVIDER_POLICY === "call_link_only";
  record(checks, "call_link_compatibility_binding", ok, {
    deploymentConfigured: Boolean(deployment),
  });
  if (!ok) issues.push("idle candidate requires an exact call_link_only deployment binding");
}

function checkSecrets(env, checks, issues) {
  const names = [
    "INTERNAL_API_SECRET",
    "REALTIME_TOKEN_SECRET",
    "PUBLIC_GATEWAY_CREDENTIAL_ACCESS_SECRET",
    "CALL_LINK_WORKER_TTS_CREDENTIAL_ACCESS_SECRET",
    "PUBLIC_RATE_LIMIT_KEY_SECRET",
    "LIVEKIT_DISPATCH_TICKET_SECRET",
  ];
  const values = names.map((name) => env[name] ?? "");
  const valid = values.every(safeSecret) && new Set(values).size === values.length;
  record(checks, "independent_runtime_secrets", valid, {
    configuredCount: values.filter(Boolean).length,
  });
  if (!valid) issues.push("idle candidate requires independent non-empty runtime secrets");
}

function checkNoModelEndpoints(env, checks, issues) {
  const configured = modelEndpointKeys.filter((key) => hasValue(env[key]));
  const ok = configured.length === 0;
  record(checks, "no_model_or_llm_endpoint", ok, { configured });
  if (!ok) issues.push("idle candidate must not configure ASR, MT, TTS, or LLM endpoints");
}

function protectedFile(file) {
  try {
    const stat = lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o600;
  } catch {
    return false;
  }
}

function resolve(rootPath, value) {
  return path.isAbsolute(value) ? value : path.resolve(rootPath, value);
}

function value(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function number(value) {
  return typeof value === "number" ? value : Number(value);
}

function safeSecret(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4096 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function record(checks, name, ok, details) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}
