#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const output = value("--output");
const candidateId = value("--candidate-id");
const publicHost = value("--public-host");
const apiPort = integer("--api-port");
const realtimePort = integer("--realtime-port");
const agentPort = integer("--translation-agent-port");
if (!output || !candidateId || !publicHost || !apiPort || !realtimePort || !agentPort) {
  throw Error("output, candidate-id, public-host, api-port, realtime-port, and translation-agent-port are required");
}
if (!/^[A-Za-z0-9_-]{8,128}$/.test(candidateId) ||
  !/^[A-Za-z0-9.:-]{1,240}$/.test(publicHost) ||
  new Set([apiPort, realtimePort, agentPort]).size !== 3) {
  throw Error("candidate identity or ports are invalid");
}
const target = path.resolve(output);
const directory = path.dirname(target);
if (existsSync(target)) throw Error("refusing to overwrite an existing candidate env file");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const lines = [
  ["CANDIDATE_DEPLOYMENT_PROFILE", "call_link_tts_idle_test"],
  ["NODE_ENV", "development"],
  ["DEPLOYMENT_ENVIRONMENT", "call-link-tts-idle-test"],
  ["REGION_EDITION", "domestic"],
  ["DATA_REGION", "cn"],
  ["COMPLIANCE_PROFILE", "pipl"],
  ["API_TEST_AUTO_ACCOUNT", "true"],
  ["AUTH_DEBUG_OTP", "true"],
  ["API_STORAGE_DRIVER", "json"],
  ["API_RESULT_SYNC_DEPLOYMENT_ID", candidateId],
  ["CALL_PROVIDER_POLICY", "call_link_only"],
  ["CALL_LINK_1_0_COMPATIBILITY_ENABLED", "true"],
  ["CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID", candidateId],
  ["CALL_LINK_1_0_COMPATIBILITY_PROFILE", "call_link_only"],
  ["CALL_LINK_PUBLIC_TTS_ENABLED", "true"],
  ["CALL_LINK_DEPLOYMENT_TEST_MODE", "true"],
  ["PUBLIC_RUNTIME_ENABLED", "false"],
  ["PUBLIC_RATE_LIMIT_PROVIDER", "memory"],
  ["PUBLIC_RATE_LIMIT_KEY_PREFIX", `wujie:${candidateId}:idle`],
  ["PUBLIC_CALL_BASE_URL", `http://${publicHost}:${apiPort}`],
  ["API_CORS_ALLOWED_ORIGINS", `http://${publicHost}:${apiPort}`],
  ["API_TRUST_PROXY_ADDRESSES", "127.0.0.1,::1"],
  ["API_BIND_HOST", "0.0.0.0"],
  ["API_PORT", String(apiPort)],
  ["REALTIME_BIND_HOST", "0.0.0.0"],
  ["REALTIME_PORT", String(realtimePort)],
  ["REALTIME_WS_ENDPOINT", `ws://${publicHost}:${realtimePort}/realtime`],
  ["REALTIME_ALLOWED_HOSTS", `${publicHost}:${realtimePort}`],
  ["REALTIME_ALLOW_NON_BROWSER_CLIENTS_WITHOUT_ORIGIN", "true"],
  ["REALTIME_ALLOW_QUERY_TOKEN", "false"],
  ["SESSION_EVENT_SINK", "api"],
  ["API_BASE_URL", `http://127.0.0.1:${apiPort}`],
  ["TRANSLATION_WORKER_API_TIMEOUT_MS", "5000"],
  ["TRANSLATION_WORKER_RUNTIME_PROVIDER", "local_process"],
  ["LIVEKIT_URL", "ws://127.0.0.1:19999"],
  ["LIVEKIT_API_KEY", "idle-test-livekit-key"],
  ["LIVEKIT_TRANSLATION_AGENT_NAME", `translation-runtime-${candidateId}`],
  ["LIVEKIT_AGENT_BIND_HOST", "0.0.0.0"],
  ["LIVEKIT_AGENT_PORT", String(agentPort)],
  ["LIVEKIT_AGENT_IDLE_PROCESSES", "1"],
  ["LIVEKIT_AGENT_MAX_JOBS_PER_NODE", "1"],
  ["WUJIE_AI_TRANSLATION_AGENT_ENABLED", "true"],
  ["WUJIE_AI_AGENT_CALL_WORKER_ENABLED", "false"],
  ["WUJIE_AI_VOICE_AGENT_ENABLED", "false"],
  ["WUJIE_AI_AIR_DEVICE_GATEWAY_ENABLED", "false"],
  ["WUJIE_AI_SRT_INGRESS_ENABLED", "false"],
  ["LLM_PROVIDER", "off"],
  ["LLM_REFINEMENT_ENABLED", "false"],
  ["LLM_REVIEW_ENABLED", "false"],
  ["INTERNAL_API_SECRET", secret()],
  ["REALTIME_TOKEN_SECRET", secret()],
  ["PUBLIC_GATEWAY_CREDENTIAL_ACCESS_SECRET", secret()],
  ["CALL_LINK_WORKER_TTS_CREDENTIAL_ACCESS_SECRET", secret()],
  ["PUBLIC_RATE_LIMIT_KEY_SECRET", secret()],
  ["LIVEKIT_API_SECRET", secret()],
  ["LIVEKIT_DISPATCH_TICKET_SECRET", secret()],
];
const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
const fd = openSync(temporary, "wx", 0o600);
try {
  writeFileSync(fd, `${lines.map(([key, value]) => `${key}=${value}`).join("\n")}\n`, "utf8");
} finally {
  closeSync(fd);
}
renameSync(temporary, target);
console.log(target);

function value(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function integer(flag) {
  const value = Number(valueFor(flag));
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : undefined;
}

function valueFor(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function secret() {
  return randomBytes(32).toString("hex");
}
