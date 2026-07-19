export interface VoiceAgentRuntimeEnv {
  apiBaseUrl: string;
  internalApiSecret: string;
  apiTimeoutMs: number;
  agentName: string;
  host: string;
  port: number;
  maxJobs: number;
  idleProcesses: number;
  drainTimeoutMs: number;
  shutdownTimeoutMs: number;
  initializeTimeoutMs: number;
  jobMemoryWarnMB: number;
  jobMemoryLimitMB: number;
  heartbeatSeconds: number;
  sttModel: string;
  llmModel: string;
  ttsModel: string;
  ttsVoice: string;
  inferenceUrl?: string;
  inferenceApiKey: string;
  inferenceApiSecret: string;
  amdModel?: string;
  amdNoSpeechTimeoutMs: number;
  amdDetectionTimeoutMs: number;
  voicemailEnabled: boolean;
}

export function loadVoiceAgentRuntimeEnv(): VoiceAgentRuntimeEnv {
  if (process.env.VOICE_AGENT_ENABLED !== "true" ||
    process.env.VOICE_AGENT_AUTONOMOUS_ENABLED !== "true" ||
    process.env.VOICE_AGENT_RUNTIME_PROVIDER !== "livekit_dispatch") {
    throw new Error("Autonomous Voice Agent runtime is disabled");
  }
  return {
    apiBaseUrl: required("API_BASE_URL").replace(/\/$/, ""),
    internalApiSecret: required("INTERNAL_API_SECRET", 16),
    apiTimeoutMs: integer("VOICE_AGENT_API_TIMEOUT_MS", 10_000, 1_000, 60_000),
    agentName: process.env.LIVEKIT_VOICE_AGENT_NAME?.trim() || "voice-agent-runtime",
    host: process.env.VOICE_AGENT_BIND_HOST?.trim() || "0.0.0.0",
    port: integer("VOICE_AGENT_PORT", 8082, 1024, 65_535),
    maxJobs: integer("VOICE_AGENT_MAX_JOBS_PER_NODE", 2, 1, 32),
    idleProcesses: integer("VOICE_AGENT_IDLE_PROCESSES", 1, 1, 32),
    drainTimeoutMs: integer("VOICE_AGENT_DRAIN_TIMEOUT_SECONDS", 90, 5, 600) * 1000,
    shutdownTimeoutMs: integer("VOICE_AGENT_SHUTDOWN_TIMEOUT_SECONDS", 45, 5, 180) * 1000,
    initializeTimeoutMs:
      integer("VOICE_AGENT_INITIALIZE_TIMEOUT_SECONDS", 30, 5, 180) * 1000,
    jobMemoryWarnMB: integer("VOICE_AGENT_JOB_MEMORY_WARN_MB", 768, 128, 8192),
    jobMemoryLimitMB: integer("VOICE_AGENT_JOB_MEMORY_LIMIT_MB", 1024, 256, 16384),
    heartbeatSeconds:
      integer("VOICE_AGENT_DISPATCH_HEARTBEAT_SECONDS", 15, 5, 60),
    sttModel: required("VOICE_AGENT_STT_MODEL"),
    llmModel: required("VOICE_AGENT_LLM_MODEL"),
    ttsModel: required("VOICE_AGENT_TTS_MODEL"),
    ttsVoice: required("VOICE_AGENT_TTS_VOICE"),
    ...(process.env.VOICE_AGENT_INFERENCE_URL?.trim()
      ? { inferenceUrl: process.env.VOICE_AGENT_INFERENCE_URL.trim() }
      : {}),
    inferenceApiKey: process.env.LIVEKIT_INFERENCE_API_KEY?.trim() ||
      required("LIVEKIT_API_KEY"),
    inferenceApiSecret: process.env.LIVEKIT_INFERENCE_API_SECRET?.trim() ||
      required("LIVEKIT_API_SECRET"),
    ...(process.env.VOICE_AGENT_AMD_MODEL?.trim()
      ? { amdModel: process.env.VOICE_AGENT_AMD_MODEL.trim() }
      : {}),
    amdNoSpeechTimeoutMs:
      integer("VOICE_AGENT_AMD_NO_SPEECH_TIMEOUT_MS", 12_000, 2_000, 60_000),
    amdDetectionTimeoutMs:
      integer("VOICE_AGENT_AMD_DETECTION_TIMEOUT_MS", 30_000, 5_000, 120_000),
    voicemailEnabled: process.env.VOICE_AGENT_VOICEMAIL_ENABLED === "true",
  };
}

function required(name: string, minimumBytes = 1) {
  const value = process.env[name]?.trim() ?? "";
  if (Buffer.byteLength(value) < minimumBytes) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function integer(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be ${minimum}-${maximum}`);
  }
  return parsed;
}
