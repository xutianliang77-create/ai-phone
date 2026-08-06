import { spawn } from "node:child_process";

const children = new Map();
let stopping = false;

const components = [
  {
    name: "api",
    enabled: () => true,
    args: ["services/api-server/dist/main.js"],
    critical: true,
  },
  {
    name: "realtime",
    enabled: () => true,
    args: ["services/realtime-gateway/dist/main.js"],
    critical: true,
  },
  {
    name: "translation-agent",
    enabled: () => flag("WUJIE_AI_TRANSLATION_AGENT_ENABLED", true),
    args: [
      "services/translation-worker/dist/livekit-agent/translation-agent-server.js",
      "start",
    ],
    critical: true,
  },
  {
    name: "agent-call-worker",
    enabled: () => flag(
      "WUJIE_AI_AGENT_CALL_WORKER_ENABLED",
      process.env.AGENT_CALL_WORKER_ENABLED === "true",
    ),
    args: ["services/translation-worker/dist/agent-calls/main.js"],
    critical: false,
  },
  {
    name: "voice-agent",
    enabled: () => flag("WUJIE_AI_VOICE_AGENT_ENABLED", false),
    args: ["services/voice-agent-runtime/dist/agent-server.js", "start"],
    critical: false,
  },
  {
    name: "air-device-gateway",
    enabled: () => flag("WUJIE_AI_AIR_DEVICE_GATEWAY_ENABLED", false),
    args: ["services/air-device-gateway/dist/main.js"],
    critical: false,
  },
  {
    name: "srt-ingress",
    enabled: () => flag("WUJIE_AI_SRT_INGRESS_ENABLED", false),
    args: ["services/srt-ingress-bridge/dist/main.js"],
    critical: false,
  },
];

for (const component of components) {
  if (!component.enabled()) continue;
  const child = spawn(process.execPath, component.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  children.set(component.name, child);
  child.once("error", (error) => {
    console.error(`[wujie-ai] ${component.name} failed to spawn`, error);
    if (component.critical) void stop(1);
  });
  child.once("exit", (code, signal) => {
    children.delete(component.name);
    if (!stopping && component.critical) {
      console.error(
        `[wujie-ai] critical component ${component.name} exited ` +
          `code=${code ?? "null"} signal=${signal ?? "null"}`,
      );
      void stop(code && code > 0 ? code : 1);
    }
  });
}

if (children.size === 0) {
  console.error("[wujie-ai] no application components are enabled");
  process.exit(1);
}

console.log(
  `[wujie-ai] single application container started: ${
    [...children.keys()].join(", ")
  }`,
);

process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));

async function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) child.kill("SIGTERM");
  await Promise.race([
    Promise.all([...children.values()].map(waitForExit)),
    new Promise((resolve) => setTimeout(resolve, 15_000)),
  ]);
  for (const child of children.values()) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
  process.exit(code);
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", resolve);
  });
}

function flag(name, fallback) {
  const value = process.env[name];
  return value === undefined ? fallback : value === "true";
}
