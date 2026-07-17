import { fileURLToPath } from "node:url";
import {
  cli,
  ServerOptions,
  WorkerPermissions,
} from "@livekit/agents";
import { TrackSource } from "@livekit/protocol";
import { parseWorkerDispatchMetadata } from "./worker-dispatch-runtime-client.js";

const workerLiveKitUrl = process.env.LIVEKIT_WORKER_URL?.trim();
if (workerLiveKitUrl) process.env.LIVEKIT_URL = workerLiveKitUrl;

const maxJobs = integerEnv("LIVEKIT_AGENT_MAX_JOBS_PER_NODE", 4, 1, 32);
const agentName = process.env.LIVEKIT_TRANSLATION_AGENT_NAME?.trim() ||
  "translation-runtime";

cli.runApp(new ServerOptions({
  agent: fileURLToPath(new URL("./translation-agent-definition.js", import.meta.url)),
  agentName,
  host: "0.0.0.0",
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
  permissions: new WorkerPermissions(
    true,
    true,
    false,
    false,
    [TrackSource.MICROPHONE],
    true,
  ),
  requestFunc: async (request) => {
    const ticket = parseWorkerDispatchMetadata(request.job.metadata);
    if (!ticket || request.agentName !== agentName ||
      request.room?.name !== ticket.roomName || ticket.agentName !== agentName) {
      await request.reject();
      return;
    }
    await request.accept(
      "Translation Runtime",
      `translation-${ticket.callId.slice(0, 12)}-g${ticket.generation}`,
      JSON.stringify({
        participantRole: "worker",
        dispatchGeneration: ticket.generation,
      }),
      {
        "translation.role": "worker",
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
