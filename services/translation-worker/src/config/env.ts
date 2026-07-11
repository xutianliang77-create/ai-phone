import { mergeModelRoutingEnv } from "./model-routing-env.js";
import type { TtsVoiceConfig, TtsVoiceMode } from "../worker/types.js";

export interface TranslationWorkerEnv {
  apiBaseUrl: string;
  internalApiSecret?: string;
  apiTimeoutMs: number;
  callId?: string;
  participantName: string;
  audioSampleRate: 16000 | 24000;
  audioFrameSizeMs: number;
  asrHttpEndpoint: string;
  asrHttpFlushEndpoint?: string;
  asrHttpApiKey?: string;
  asrHttpTimeoutMs: number;
  translationBaseUrl: string;
  translationModel: string;
  translationApiKey?: string;
  translationTimeoutMs: number;
  translationMaxTokens: number;
  ttsHttpEndpoint?: string;
  ttsHttpApiKey?: string;
  ttsHttpTimeoutMs: number;
  ttsProvider?: string;
  ttsModel?: string;
  ttsVoice?: TtsVoiceConfig;
  ttsAudioSinkEndpoint?: string;
  ttsAudioSinkApiKey?: string;
  ttsAudioSinkTimeoutMs: number;
  audioFrameSinkPort: number;
  audioFrameSinkApiKey?: string;
  agentCallWorkerBatchSize: number;
  agentCallWorkerPollIntervalMs: number;
  pstnBridgeBaseUrl?: string;
  pstnBridgeApiKey?: string;
  pstnBridgeTimeoutMs: number;
}

export function loadEnv(): TranslationWorkerEnv {
  const env = mergeModelRoutingEnv("translationWorker");
  return {
    apiBaseUrl: env.API_BASE_URL ?? "http://127.0.0.1:3100",
    internalApiSecret: env.INTERNAL_API_SECRET,
    apiTimeoutMs: Number(env.TRANSLATION_WORKER_API_TIMEOUT_MS ?? 5000),
    callId: env.TRANSLATION_WORKER_CALL_ID,
    participantName: env.TRANSLATION_WORKER_PARTICIPANT_NAME ??
      "translation-worker",
    audioSampleRate: parseAudioSampleRate(env.TRANSLATION_WORKER_AUDIO_SAMPLE_RATE),
    audioFrameSizeMs: Number(env.TRANSLATION_WORKER_AUDIO_FRAME_SIZE_MS ?? 100),
    asrHttpEndpoint:
      env.ASR_HTTP_ENDPOINT ?? "http://127.0.0.1:8001/asr/transcribe",
    asrHttpFlushEndpoint: env.ASR_HTTP_FLUSH_ENDPOINT,
    asrHttpApiKey: env.ASR_HTTP_API_KEY,
    asrHttpTimeoutMs: Number(env.ASR_HTTP_TIMEOUT_MS ?? 10000),
    translationBaseUrl:
      env.TRANSLATION_BASE_URL ??
      env.LMSTUDIO_BASE_URL ??
      "http://127.0.0.1:1234/v1",
    translationModel:
      env.TRANSLATION_MODEL ??
      env.LMSTUDIO_MODEL ??
      "tencent/Hy-MT2-1.8B",
    translationApiKey: env.TRANSLATION_API_KEY ?? env.LMSTUDIO_API_KEY,
    translationTimeoutMs: Number(
      env.TRANSLATION_TIMEOUT_MS ??
        env.LMSTUDIO_TIMEOUT_MS ??
        20000,
    ),
    translationMaxTokens: Number(
      env.TRANSLATION_MAX_TOKENS ??
        env.LMSTUDIO_MAX_TOKENS ??
        512,
    ),
    ttsHttpEndpoint: env.TTS_HTTP_ENDPOINT,
    ttsHttpApiKey: env.TTS_HTTP_API_KEY,
    ttsHttpTimeoutMs: Number(env.TTS_HTTP_TIMEOUT_MS ?? 10000),
    ttsProvider: env.TTS_PROVIDER,
    ttsModel: env.TTS_MODEL,
    ttsVoice: parseTtsVoiceConfig(env),
    ttsAudioSinkEndpoint: env.TTS_AUDIO_SINK_ENDPOINT,
    ttsAudioSinkApiKey: env.TTS_AUDIO_SINK_API_KEY,
    ttsAudioSinkTimeoutMs: Number(env.TTS_AUDIO_SINK_TIMEOUT_MS ?? 5000),
    audioFrameSinkPort: Number(env.TRANSLATION_WORKER_AUDIO_FRAME_SINK_PORT ?? 3312),
    audioFrameSinkApiKey: env.TRANSLATION_WORKER_AUDIO_FRAME_SINK_API_KEY,
    agentCallWorkerBatchSize: Number(env.AGENT_CALL_WORKER_BATCH_SIZE ?? 5),
    agentCallWorkerPollIntervalMs: Number(env.AGENT_CALL_WORKER_POLL_INTERVAL_MS ?? 5000),
    pstnBridgeBaseUrl: env.PSTN_BRIDGE_BASE_URL,
    pstnBridgeApiKey: env.PSTN_BRIDGE_API_KEY,
    pstnBridgeTimeoutMs: Number(env.PSTN_BRIDGE_TIMEOUT_MS ?? 10000),
  };
}

function parseAudioSampleRate(value: string | undefined): 16000 | 24000 {
  return value === "16000" ? 16000 : 24000;
}

function parseTtsVoiceConfig(env: Record<string, string | undefined>): TtsVoiceConfig | undefined {
  const mode = parseTtsVoiceMode(env.TTS_VOICE_MODE);
  if (!mode) return undefined;
  return {
    mode,
    ...optionalString("voiceProfileId", env.TTS_VOICE_PROFILE_ID),
    ...optionalString("referenceAudioId", env.TTS_VOICE_REFERENCE_AUDIO_ID),
    ...optionalString("referenceTranscript", env.TTS_VOICE_REFERENCE_TRANSCRIPT),
    ...optionalString("controlPrompt", env.TTS_VOICE_CONTROL_PROMPT),
  };
}

function parseTtsVoiceMode(value: string | undefined): TtsVoiceMode | undefined {
  if (
    value === "preset" ||
    value === "voice_design" ||
    value === "personal_clone" ||
    value === "ultimate_clone"
  ) {
    return value;
  }
  return undefined;
}

function optionalString<K extends keyof TtsVoiceConfig>(key: K, value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? { [key]: trimmed } : {};
}
