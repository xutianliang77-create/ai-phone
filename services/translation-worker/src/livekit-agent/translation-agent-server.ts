import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  cli,
  ServerOptions,
} from "@livekit/agents";
import pino from "pino";
import { loadEnv } from "../config/env.js";
import { parseWorkerDispatchMetadata } from "./worker-dispatch-runtime-client.js";
import { createTranslationAgentPermissions } from "./translation-agent-permissions.js";
import { prewarmTranslationAgentLlm } from "./translation-agent-llm-prewarm.js";
import { prewarmTranslationAgentTts } from "./translation-agent-tts-prewarm.js";

const logger = pino({ name: "translation-livekit-agent-server" });

const workerLiveKitUrl = process.env.LIVEKIT_WORKER_URL?.trim();
if (workerLiveKitUrl) process.env.LIVEKIT_URL = workerLiveKitUrl;

const maxJobs = integerEnv("LIVEKIT_AGENT_MAX_JOBS_PER_NODE", 4, 1, 32);
const agentName = process.env.LIVEKIT_TRANSLATION_AGENT_NAME?.trim() ||
  "translation-runtime";
const dependencyRetryDelayMs = integerEnv(
  "TRANSLATION_AGENT_DEPENDENCY_RETRY_DELAY_MS",
  5_000,
  1_000,
  120_000,
);
const env = loadEnv();
let dependenciesReady = false;
const dependencyReadinessFile = readinessFilePath();
writeDependencyReadiness(false);

void refreshDependencies();

async function refreshDependencies(): Promise<void> {
  try {
    const ttsPrewarm = await prewarmTranslationAgentTts(env);
    const llmPrewarm = await prewarmTranslationAgentLlm(env);
    dependenciesReady = true;
    writeDependencyReadiness(true);
    logger.info(
      { ttsPrewarm, llmPrewarm },
      "Translation Agent dependency readiness established",
    );
  } catch (error) {
    dependenciesReady = false;
    writeDependencyReadiness(false);
    logger.error(
      { err: error, retryDelayMs: dependencyRetryDelayMs },
      "Translation Agent dependency prewarm failed; rejecting new jobs until retry succeeds",
    );
    const retryTimer = setTimeout(() => {
      void refreshDependencies();
    }, dependencyRetryDelayMs);
    retryTimer.unref();
  }
}

function readinessFilePath() {
  const value = process.env.TRANSLATION_AGENT_READINESS_FILE?.trim() ||
    "/tmp/wujie-ai/translation-agent-ready";
  if (!isAbsolute(value) || resolve(value) === "/" || value.length > 1_024) {
    throw new Error("TRANSLATION_AGENT_READINESS_FILE is invalid");
  }
  return resolve(value);
}

function writeDependencyReadiness(ready: boolean) {
  mkdirSync(dirname(dependencyReadinessFile), { recursive: true, mode: 0o700 });
  writeFileSync(dependencyReadinessFile, ready ? "ready\n" : "not_ready\n", {
    encoding: "utf8",
    mode: 0o600,
  });
}

cli.runApp(new ServerOptions({
  agent: fileURLToPath(new URL("./translation-agent-definition.js", import.meta.url)),
  agentName,
  host: process.env.LIVEKIT_AGENT_BIND_HOST?.trim() || "0.0.0.0",
  port: integerEnv("LIVEKIT_AGENT_PORT", 8081, 1024, 65_535),
  loadFunc: async (server) => Math.min(1, server.activeJobs.length / maxJobs),
  loadThreshold: 0.99,
  numIdleProcesses: integerEnv("LIVEKIT_AGENT_IDLE_PROCESSES", 2, 1, maxJobs),
  drainTimeout: integerEnv("LIVEKIT_AGENT_DRAIN_TIMEOUT_SECONDS", 60, 5, 600) * 1000,
  shutdownProcessTimeout:
    integerEnv("LIVEKIT_AGENT_SHUTDOWN_TIMEOUT_SECONDS", 30, 5, 120) * 1000,
  initializeProcessTimeout:
    integerEnv("LIVEKIT_AGENT_INITIALIZE_TIMEOUT_SECONDS", 20, 5, 120) * 1000,
  jobMemoryWarnMB: integerEnv("LIVEKIT_AGENT_JOB_MEMORY_WARN_MB", 768, 128, 8192),
  jobMemoryLimitMB: integerEnv("LIVEKIT_AGENT_JOB_MEMORY_LIMIT_MB", 1024, 256, 16384),
  permissions: createTranslationAgentPermissions(),
  requestFunc: async (request) => {
    const ticket = parseWorkerDispatchMetadata(request.job.metadata);
    if (!dependenciesReady || !ticket || request.agentName !== agentName ||
      request.room?.name !== ticket.roomName || ticket.agentName !== agentName) {
      await request.reject();
      return;
    }
    await request.accept(
      "Translation Runtime",
      `translation-${ticket.callId.slice(0, 12)}-g${ticket.generation}`,
      JSON.stringify({
        participantRole: "worker",
        callId: ticket.callId,
        sessionId: ticket.sessionId,
        agentKind: "call_translation",
        dispatchGeneration: ticket.generation,
      }),
      {
        "translation.role": "worker",
        "translation.callId": ticket.callId,
        "translation.sessionId": ticket.sessionId,
        "translation.agentKind": "call_translation",
        "translation.generation": String(ticket.generation),
      },
    );
  },
}));

function integerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}
