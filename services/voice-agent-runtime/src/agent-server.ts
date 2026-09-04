import { fileURLToPath } from "node:url";
import {
  cli,
  ServerOptions,
} from "@livekit/agents";
import { loadVoiceAgentRuntimeEnv } from "./config.js";
import { parseVoiceAgentDispatchTicket } from "./runtime-ticket.js";
import { voiceAgentParticipantIdentity } from
  "./voice-agent-participant-identity.js";
import { createVoiceAgentWorkerPermissions } from
  "./voice-agent-worker-permissions.js";

const workerLiveKitUrl = process.env.LIVEKIT_WORKER_URL?.trim();
if (workerLiveKitUrl) process.env.LIVEKIT_URL = workerLiveKitUrl;

const env = loadVoiceAgentRuntimeEnv();

cli.runApp(new ServerOptions({
  agent: fileURLToPath(new URL("./agent-definition.js", import.meta.url)),
  agentName: env.agentName,
  host: env.host,
  port: env.port,
  loadFunc: async (server) => Math.min(1, server.activeJobs.length / env.maxJobs),
  loadThreshold: 0.99,
  numIdleProcesses: Math.min(env.idleProcesses, env.maxJobs),
  drainTimeout: env.drainTimeoutMs,
  shutdownProcessTimeout: env.shutdownTimeoutMs,
  initializeProcessTimeout: env.initializeTimeoutMs,
  jobMemoryWarnMB: env.jobMemoryWarnMB,
  jobMemoryLimitMB: env.jobMemoryLimitMB,
  permissions: createVoiceAgentWorkerPermissions(),
  requestFunc: async (request) => {
    const ticket = parseVoiceAgentDispatchTicket(request.job.metadata);
    if (!ticket || request.agentName !== env.agentName ||
      ticket.agentName !== env.agentName ||
      request.room?.name !== ticket.roomName) {
      await request.reject();
      return;
    }
    await request.accept(
      "Voice Agent Runtime",
      voiceAgentParticipantIdentity(ticket),
      JSON.stringify({
        participantRole: "worker",
        runtime: "voice_agent",
        dispatchGeneration: ticket.generation,
      }),
      {
        "translation.role": "worker",
        "translation.runtime": "voice_agent",
        "translation.generation": String(ticket.generation),
      },
    );
  },
}));
