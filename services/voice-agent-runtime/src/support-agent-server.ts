import { fileURLToPath } from "node:url";
import { cli, ServerOptions, WorkerPermissions } from "@livekit/agents";
import { TrackSource } from "@livekit/protocol";
import { loadSupportAgentRuntimeEnv } from "./support-agent-config.js";
import { parseSupportAgentTicket } from "./support-agent-ticket.js";

const workerLiveKitUrl = process.env.LIVEKIT_WORKER_URL?.trim();
if (workerLiveKitUrl) process.env.LIVEKIT_URL = workerLiveKitUrl;
const env = loadSupportAgentRuntimeEnv();

cli.runApp(new ServerOptions({
  agent: fileURLToPath(new URL("./support-agent-definition.js", import.meta.url)),
  agentName: env.agentName,
  host: "0.0.0.0",
  port: env.port,
  loadFunc: async (server) => Math.min(1, server.activeJobs.length / env.maxJobs),
  loadThreshold: 0.99,
  numIdleProcesses: Math.min(env.idleProcesses, env.maxJobs),
  permissions: new WorkerPermissions(
    true, true, false, false, [TrackSource.MICROPHONE], true,
  ),
  requestFunc: async (request) => {
    const ticket = parseSupportAgentTicket(request.job.metadata);
    if (!ticket || ticket.cellId !== env.workerCellId ||
      request.agentName !== env.agentName ||
      request.room?.name !== roomName(ticket.communicationSessionId)) {
      await request.reject();
      return;
    }
    await request.accept(
      "Enterprise Support Agent",
      `support-agent-${ticket.communicationSessionId.slice(0, 12)}-g${ticket.generation}`,
      JSON.stringify({ participantRole: "worker", runtime: "support_agent",
        dispatchGeneration: ticket.generation }),
      { "translation.role": "worker", "translation.runtime": "support_agent",
        "translation.generation": String(ticket.generation) },
    );
  },
}));

function roomName(communicationSessionId: string) {
  return `ent_${communicationSessionId.replaceAll("-", "")}`;
}
