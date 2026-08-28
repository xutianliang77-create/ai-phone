import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";

const DEFAULT_API_HEALTH_URL = "http://127.0.0.1:3110/health";
const DEFAULT_REALTIME_HEALTH_URL = "http://127.0.0.1:3111/health";
const DEFAULT_TRANSLATION_AGENT_HEALTH_URL = "http://127.0.0.1:8081/worker";
const DEFAULT_TRANSLATION_AGENT_READINESS_FILE =
  "/tmp/wujie-ai/translation-agent-ready";
const DEFAULT_SUPERVISOR_STATE_FILE = "/tmp/wujie-ai/supervisor-state.json";
const DEFAULT_VOICE_AGENT_HEALTH_URL = "http://127.0.0.1:8082/";
const DEFAULT_SRT_INGRESS_HEALTH_URL = "http://127.0.0.1:3310/health";
const DEFAULT_AIR_GATEWAY_HEALTH_URL = "http://127.0.0.1:8780/healthz";

/**
 * Checks the processes that are mandatory for the selected application profile.
 * Air780 device admission is deliberately not container health. The enabled
 * Gateway process and durable state must be healthy, while /readyz separately
 * keeps call control and media fail-closed until the physical device is admitted.
 */
export async function checkContainerHealth({
  env = process.env,
  fetchFn = fetch,
  readFileFn = readFile,
} = {}) {
  const endpoints = [{
    name: "api",
    url: env.API_HEALTH_URL || DEFAULT_API_HEALTH_URL,
  }, {
    name: "realtime",
    url: env.GATEWAY_HEALTH_URL || DEFAULT_REALTIME_HEALTH_URL,
  }];

  const translationEnabled = env.WUJIE_AI_TRANSLATION_AGENT_ENABLED !== "false";
  if (translationEnabled) {
    endpoints.push({
      name: "translation-agent",
      url: env.TRANSLATION_AGENT_HEALTH_URL ||
        DEFAULT_TRANSLATION_AGENT_HEALTH_URL,
    });
  }

  if (env.WUJIE_AI_VOICE_AGENT_ENABLED === "true") {
    endpoints.push({
      name: "voice-agent",
      url: env.VOICE_AGENT_HEALTH_URL || DEFAULT_VOICE_AGENT_HEALTH_URL,
    });
  }

  if (env.WUJIE_AI_SRT_INGRESS_ENABLED === "true") {
    endpoints.push({
      name: "srt-ingress",
      url: env.SRT_INGRESS_HEALTH_URL || DEFAULT_SRT_INGRESS_HEALTH_URL,
    });
  }

  if (env.WUJIE_AI_AIR_DEVICE_GATEWAY_ENABLED === "true") {
    endpoints.push({
      name: "air-device-gateway",
      url: env.AIR_GATEWAY_HEALTH_URL || DEFAULT_AIR_GATEWAY_HEALTH_URL,
    });
  }

  for (const endpoint of endpoints) {
    let response;
    try {
      response = await fetchFn(endpoint.url);
    } catch {
      throw new Error(`${endpoint.name} health request failed`);
    }
    if (!response.ok) {
      throw new Error(`${endpoint.name} health returned HTTP ${response.status}`);
    }
  }

  await requireSupervisorReady(env, readFileFn);

  if (translationEnabled) {
    const path = env.TRANSLATION_AGENT_READINESS_FILE ||
      DEFAULT_TRANSLATION_AGENT_READINESS_FILE;
    let readiness;
    try {
      readiness = await readFileFn(path, "utf8");
    } catch {
      throw new Error("translation-agent dependency readiness unavailable");
    }
    if (readiness.trim() !== "ready") {
      throw new Error("translation-agent dependencies are not ready");
    }
  }
}

async function requireSupervisorReady(env, readFileFn) {
  const path = env.WUJIE_AI_SUPERVISOR_STATE_FILE ||
    DEFAULT_SUPERVISOR_STATE_FILE;
  let state;
  try {
    state = JSON.parse(await readFileFn(path, "utf8"));
  } catch {
    throw new Error("wujie-ai supervisor readiness unavailable");
  }
  if (state?.version !== 1 || !state.components ||
    typeof state.components !== "object") {
    throw new Error("wujie-ai supervisor readiness invalid");
  }
  for (const component of expectedComponents(env)) {
    if (state.components[component] !== "running") {
      throw new Error(`wujie-ai component ${component} is not running`);
    }
  }
}

function expectedComponents(env) {
  const names = ["api", "realtime"];
  if (env.WUJIE_AI_TRANSLATION_AGENT_ENABLED !== "false") {
    names.push("translation-agent");
  }
  if (env.WUJIE_AI_AGENT_CALL_WORKER_ENABLED === "true" ||
    (env.WUJIE_AI_AGENT_CALL_WORKER_ENABLED === undefined &&
      env.AGENT_CALL_WORKER_ENABLED === "true")) {
    names.push("agent-call-worker");
  }
  if (env.WUJIE_AI_VOICE_AGENT_ENABLED === "true") names.push("voice-agent");
  if (env.WUJIE_AI_AIR_DEVICE_GATEWAY_ENABLED === "true") {
    names.push("air-device-gateway");
  }
  if (env.WUJIE_AI_SRT_INGRESS_ENABLED === "true") names.push("srt-ingress");
  return names;
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkContainerHealth().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
