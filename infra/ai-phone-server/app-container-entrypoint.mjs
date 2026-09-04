import { spawn } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const children = new Map();
const restartTimers = new Map();
const restartAttempts = new Map();
let stopping = false;
const supervisorStateFile = resolveSupervisorStateFile();

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
    critical: false,
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

const enabledComponents = components.filter((component) => component.enabled());
if (enabledComponents.length === 0) {
  console.error("[wujie-ai] no application components are enabled");
  process.exit(1);
}
const componentStates = new Map(
  enabledComponents.map((component) => [component.name, "starting"]),
);
writeSupervisorState();
for (const component of enabledComponents) spawnComponent(component);

console.log(
  `[wujie-ai] single application container started: ${
    enabledComponents.map((component) => component.name).join(", ")
  }`,
);

process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));

function spawnComponent(component) {
  if (stopping) return;
  componentStates.set(component.name, "starting");
  writeSupervisorState();
  const startedAt = Date.now();
  const child = spawn(process.execPath, component.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  children.set(component.name, child);
  componentStates.set(component.name, "running");
  writeSupervisorState();
  let settled = false;
  const handleFailure = (code, signal, error) => {
    if (settled) return;
    settled = true;
    if (children.get(component.name) === child) {
      children.delete(component.name);
    }
    if (stopping) return;
    const detail = error
      ? `spawn_error=${error.name}`
      : `code=${code ?? "null"} signal=${signal ?? "null"}`;
    if (component.critical) {
      componentStates.set(component.name, "failed");
      writeSupervisorState();
      console.error(
        `[wujie-ai] critical component ${component.name} exited ${detail}`,
      );
      void stop(code && code > 0 ? code : 1);
      return;
    }
    componentStates.set(component.name, "restarting");
    writeSupervisorState();
    console.error(
      `[wujie-ai] recoverable component ${component.name} exited ${detail}`,
    );
    scheduleRestart(component, Date.now() - startedAt);
  };
  child.once("error", (error) => handleFailure(null, null, error));
  child.once("exit", (code, signal) => handleFailure(code, signal));
}

function scheduleRestart(component, uptimeMs) {
  if (stopping || restartTimers.has(component.name)) return;
  const previousAttempt = uptimeMs >= stableChildUptimeMs()
    ? 0
    : restartAttempts.get(component.name) ?? 0;
  const attempt = previousAttempt + 1;
  restartAttempts.set(component.name, attempt);
  const delayMs = Math.min(
    nonCriticalRestartMaximumMs(),
    nonCriticalRestartInitialMs() * 2 ** Math.min(attempt - 1, 10),
  );
  console.error(
    `[wujie-ai] restarting ${component.name} in ${delayMs}ms attempt=${attempt}`,
  );
  const timer = setTimeout(() => {
    restartTimers.delete(component.name);
    spawnComponent(component);
  }, delayMs);
  restartTimers.set(component.name, timer);
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const name of componentStates.keys()) {
    componentStates.set(name, "stopping");
  }
  writeSupervisorState();
  for (const timer of restartTimers.values()) clearTimeout(timer);
  restartTimers.clear();
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

function resolveSupervisorStateFile() {
  const value = process.env.WUJIE_AI_SUPERVISOR_STATE_FILE?.trim() ||
    "/tmp/wujie-ai/supervisor-state.json";
  if (!isAbsolute(value) || resolve(value) === "/" || value.length > 1_024) {
    throw new Error("WUJIE_AI_SUPERVISOR_STATE_FILE is invalid");
  }
  return resolve(value);
}

function writeSupervisorState() {
  const temporary = `${supervisorStateFile}.tmp`;
  mkdirSync(dirname(supervisorStateFile), { recursive: true, mode: 0o700 });
  writeFileSync(temporary, JSON.stringify({
    version: 1,
    components: Object.fromEntries(componentStates),
  }), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, supervisorStateFile);
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

function nonCriticalRestartInitialMs() {
  return boundedInteger(
    process.env.WUJIE_AI_CHILD_RESTART_INITIAL_MS,
    1_000,
    250,
    60_000,
  );
}

function nonCriticalRestartMaximumMs() {
  return boundedInteger(
    process.env.WUJIE_AI_CHILD_RESTART_MAX_MS,
    30_000,
    nonCriticalRestartInitialMs(),
    300_000,
  );
}

function stableChildUptimeMs() {
  return boundedInteger(
    process.env.WUJIE_AI_CHILD_STABLE_UPTIME_MS,
    60_000,
    1_000,
    3_600_000,
  );
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}
