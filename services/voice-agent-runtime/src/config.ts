import { isAbsolute, parse, resolve } from "node:path";

interface VoiceAgentRuntimeBaseEnv {
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
  ttsEvidenceDir?: string;
  amdModel?: string;
  amdNoSpeechTimeoutMs: number;
  amdDetectionTimeoutMs: number;
  voicemailEnabled: boolean;
}

export type VoiceAgentRuntimeEnv = VoiceAgentRuntimeBaseEnv & (
  | {
    modelProvider: "livekit_inference";
    inferenceUrl?: string;
    inferenceApiKey: string;
    inferenceApiSecret: string;
  }
  | {
    modelProvider: "local_http";
    localAsrUrl: string;
    localAsrApiKey?: string;
    localTtsUrl: string;
    localTtsApiKey?: string;
    localLlmBaseUrl: string;
    localLlmApiKey: string;
    localModelTimeoutMs: number;
  }
);

export function loadVoiceAgentRuntimeEnv(): VoiceAgentRuntimeEnv {
  if (process.env.VOICE_AGENT_ENABLED !== "true" ||
    process.env.VOICE_AGENT_AUTONOMOUS_ENABLED !== "true" ||
    process.env.VOICE_AGENT_RUNTIME_PROVIDER !== "livekit_dispatch") {
    throw new Error("Autonomous Voice Agent runtime is disabled");
  }
  const base: VoiceAgentRuntimeBaseEnv = {
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
    ...optionalAbsoluteDirectory(
      "ttsEvidenceDir",
      "VOICE_AGENT_TTS_EVIDENCE_DIR",
    ),
    ...(process.env.VOICE_AGENT_AMD_MODEL?.trim()
      ? { amdModel: process.env.VOICE_AGENT_AMD_MODEL.trim() }
      : {}),
    amdNoSpeechTimeoutMs:
      integer("VOICE_AGENT_AMD_NO_SPEECH_TIMEOUT_MS", 12_000, 2_000, 60_000),
    amdDetectionTimeoutMs:
      integer("VOICE_AGENT_AMD_DETECTION_TIMEOUT_MS", 30_000, 5_000, 120_000),
    voicemailEnabled: process.env.VOICE_AGENT_VOICEMAIL_ENABLED === "true",
  };
  const modelProvider = process.env.VOICE_AGENT_MODEL_PROVIDER?.trim() ||
    "livekit_inference";
  if (modelProvider === "local_http") {
    return {
      ...base,
      modelProvider,
      localAsrUrl: requiredHttpUrl("VOICE_AGENT_LOCAL_ASR_URL"),
      ...optionalValue("localAsrApiKey", "VOICE_AGENT_LOCAL_ASR_API_KEY"),
      localTtsUrl: requiredHttpUrl("VOICE_AGENT_LOCAL_TTS_URL"),
      ...optionalValue("localTtsApiKey", "VOICE_AGENT_LOCAL_TTS_API_KEY"),
      localLlmBaseUrl: requiredHttpUrl("VOICE_AGENT_LOCAL_LLM_BASE_URL"),
      localLlmApiKey: required("VOICE_AGENT_LOCAL_LLM_API_KEY"),
      localModelTimeoutMs:
        integer("VOICE_AGENT_LOCAL_MODEL_TIMEOUT_MS", 60_000, 1_000, 300_000),
    };
  }
  if (modelProvider !== "livekit_inference") {
    throw new Error("VOICE_AGENT_MODEL_PROVIDER must be livekit_inference or local_http");
  }
  return {
    ...base,
    modelProvider,
    ...(process.env.VOICE_AGENT_INFERENCE_URL?.trim()
      ? { inferenceUrl: process.env.VOICE_AGENT_INFERENCE_URL.trim() }
      : {}),
    inferenceApiKey: process.env.LIVEKIT_INFERENCE_API_KEY?.trim() ||
      required("LIVEKIT_API_KEY"),
    inferenceApiSecret: process.env.LIVEKIT_INFERENCE_API_SECRET?.trim() ||
      required("LIVEKIT_API_SECRET"),
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

function requiredHttpUrl(name: string) {
  const value = required(name).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an HTTP URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must be an HTTP URL`);
  }
  return value;
}

function optionalValue<Key extends string>(key: Key, name: string) {
  const value = process.env[name]?.trim();
  return value ? { [key]: value } as Record<Key, string> : {};
}

function optionalAbsoluteDirectory<Key extends string>(key: Key, name: string) {
  const value = process.env[name]?.trim();
  if (!value) return {};
  const absolute = resolve(value);
  if (!isAbsolute(value) || absolute === parse(absolute).root) {
    throw new Error(`${name} must be an absolute non-root directory`);
  }
  return { [key]: absolute } as Record<Key, string>;
}
