export interface SupportAgentRuntimeEnv {
  apiBaseUrl: string;
  internalApiSecret: string;
  apiTimeoutMs: number;
  agentName: string;
  workerCellId: string;
  port: number;
  maxJobs: number;
  idleProcesses: number;
  heartbeatSeconds: number;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  inferenceUrl?: string;
  inferenceApiKey: string;
  inferenceApiSecret: string;
}

export function loadSupportAgentRuntimeEnv(): SupportAgentRuntimeEnv {
  if (process.env.ENTERPRISE_SUPPORT_AGENT_WORKER_ENABLED !== "true" ||
    process.env.ENTERPRISE_SUPPORT_AGENT_RUNTIME_PROVIDER !== "livekit_dispatch") {
    throw new Error("Enterprise Support Agent Worker is disabled");
  }
  return {
    apiBaseUrl: required("API_BASE_URL").replace(/\/$/u, ""),
    internalApiSecret: required("INTERNAL_API_SECRET", 16),
    apiTimeoutMs: integer("ENTERPRISE_SUPPORT_AGENT_API_TIMEOUT_MS", 15_000,
      1_000, 60_000),
    agentName: process.env.LIVEKIT_ENTERPRISE_SUPPORT_AGENT_NAME?.trim() ||
      "enterprise-support-agent",
    workerCellId: required("ENTERPRISE_WORKER_CELL_ID"),
    port: integer("ENTERPRISE_SUPPORT_AGENT_PORT", 8083, 1_024, 65_535),
    maxJobs: integer("ENTERPRISE_SUPPORT_AGENT_MAX_JOBS", 4, 1, 32),
    idleProcesses: integer("ENTERPRISE_SUPPORT_AGENT_IDLE_PROCESSES", 1, 1, 32),
    heartbeatSeconds: integer("ENTERPRISE_SUPPORT_AGENT_HEARTBEAT_SECONDS", 15,
      5, 60),
    sttModel: required("ENTERPRISE_SUPPORT_AGENT_STT_MODEL"),
    ttsModel: required("ENTERPRISE_SUPPORT_AGENT_TTS_MODEL"),
    ttsVoice: required("ENTERPRISE_SUPPORT_AGENT_TTS_VOICE"),
    ...(process.env.VOICE_AGENT_INFERENCE_URL?.trim()
      ? { inferenceUrl: process.env.VOICE_AGENT_INFERENCE_URL.trim() } : {}),
    inferenceApiKey: process.env.LIVEKIT_INFERENCE_API_KEY?.trim() ||
      required("LIVEKIT_API_KEY"),
    inferenceApiSecret: process.env.LIVEKIT_INFERENCE_API_SECRET?.trim() ||
      required("LIVEKIT_API_SECRET"),
  };
}

function required(name: string, minimum = 1) {
  const value = process.env[name]?.trim() ?? "";
  if (Buffer.byteLength(value) < minimum) throw new Error(`${name} is required`);
  return value;
}
function integer(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be ${minimum}-${maximum}`);
  }
  return value;
}
