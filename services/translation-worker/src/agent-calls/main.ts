import pino from "pino";
import { loadEnv } from "../config/env.js";
import { AgentCallDispatcher } from "./agent-call-dispatcher.js";
import { HttpAgentCallApiClient } from "./agent-call-api-client.js";
import { HttpPstnBridgeProvider } from "./http-pstn-bridge-provider.js";
import { HttpVoiceAgentRuntimeProvider } from
  "./http-voice-agent-runtime-provider.js";

const logger = pino({ name: "agent-call-worker" });

export function buildDefaultAgentCallDispatcher() {
  const env = loadEnv();
  if (!env.agentCallWorkerId) return null;
  const bridge = env.agentCallProviderAdapter === "livekit_sip"
    ? new HttpVoiceAgentRuntimeProvider({
        apiBaseUrl: env.apiBaseUrl,
        internalApiSecret: env.internalApiSecret,
        timeoutMs: Math.max(env.apiTimeoutMs, 45_000),
      })
    : env.pstnBridgeBaseUrl
      ? new HttpPstnBridgeProvider({
          baseUrl: env.pstnBridgeBaseUrl,
          apiKey: env.pstnBridgeApiKey,
          timeoutMs: env.pstnBridgeTimeoutMs,
        })
      : null;
  if (!bridge) return null;
  return new AgentCallDispatcher({
    batchSize: env.agentCallWorkerBatchSize,
    workerId: env.agentCallWorkerId,
    api: new HttpAgentCallApiClient({
      apiBaseUrl: env.apiBaseUrl,
      internalApiSecret: env.internalApiSecret,
      timeoutMs: env.apiTimeoutMs,
    }),
    bridge,
  });
}

async function main() {
  const env = loadEnv();
  const dispatcher = buildDefaultAgentCallDispatcher();
  if (!dispatcher) {
    logger.info("Agent call worker is disabled; configure bridge URL and a unique worker ID.");
    return;
  }
  logger.info({ batchSize: env.agentCallWorkerBatchSize }, "Agent call worker started.");
  let stopped = false;
  process.once("SIGINT", () => {
    stopped = true;
  });
  process.once("SIGTERM", () => {
    stopped = true;
  });
  while (!stopped) {
    const dispatched = await dispatcher.dispatchOnce();
    logger.info({ dispatched }, "Agent call dispatch cycle completed.");
    await delay(env.agentCallWorkerPollIntervalMs);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isAgentCallWorkerEntrypoint(argv = process.argv) {
  return argv.some((arg) =>
    arg.endsWith("src/agent-calls/main.ts") ||
    arg.endsWith("dist/agent-calls/main.js")
  );
}

if (isAgentCallWorkerEntrypoint()) {
  main().catch((error) => {
    logger.error({ error }, "Agent call worker failed");
    process.exitCode = 1;
  });
}
