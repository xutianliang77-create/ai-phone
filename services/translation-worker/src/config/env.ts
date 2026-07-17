import { mergeModelRoutingEnv } from "./model-routing-env.js";
import { loadLlmConfig, type LlmConfig } from "@translation/llm";
import {
  parseDomainLexiconPacks,
  type DomainLexiconPack,
} from "@translation/speech-quality";
import type {
  CallDuplexConfig,
  SpeechPipelineMode,
  TtsVoiceConfig,
  TtsVoiceMode,
} from "../worker/types.js";

export interface TranslationWorkerEnv {
  apiBaseUrl: string;
  internalApiSecret?: string;
  apiTimeoutMs: number;
  callId?: string;
  participantName: string;
  audioSampleRate: 16000 | 24000;
  audioFrameSizeMs: number;
  audioIngestMaxFrames: number;
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
  ttsAudioSinkInterruptEndpoint?: string;
  ttsAudioSinkApiKey?: string;
  ttsAudioSinkTimeoutMs: number;
  audioFrameSinkPort: number;
  audioFrameSinkApiKey?: string;
  agentCallWorkerBatchSize: number;
  agentCallWorkerPollIntervalMs: number;
  agentCallWorkerId?: string;
  agentCallProviderAdapter?: string;
  pstnBridgeBaseUrl?: string;
  pstnBridgeApiKey?: string;
  pstnBridgeTimeoutMs: number;
  speechPipelineMode: SpeechPipelineMode;
  domainLexiconPacks: DomainLexiconPack[];
  llmConfig: LlmConfig;
  duplexConfig: CallDuplexConfig;
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
    audioIngestMaxFrames: boundedInteger(
      env.TRANSLATION_WORKER_AUDIO_INGEST_MAX_FRAMES,
      20,
      4,
      200,
    ),
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
    ttsAudioSinkInterruptEndpoint: env.TTS_AUDIO_SINK_INTERRUPT_ENDPOINT,
    ttsAudioSinkApiKey: env.TTS_AUDIO_SINK_API_KEY,
    ttsAudioSinkTimeoutMs: Number(env.TTS_AUDIO_SINK_TIMEOUT_MS ?? 5000),
    audioFrameSinkPort: Number(env.TRANSLATION_WORKER_AUDIO_FRAME_SINK_PORT ?? 3312),
    audioFrameSinkApiKey: env.TRANSLATION_WORKER_AUDIO_FRAME_SINK_API_KEY,
    agentCallWorkerBatchSize: Number(env.AGENT_CALL_WORKER_BATCH_SIZE ?? 5),
    agentCallWorkerPollIntervalMs: Number(env.AGENT_CALL_WORKER_POLL_INTERVAL_MS ?? 5000),
    agentCallWorkerId: env.AGENT_CALL_WORKER_ID?.trim() || undefined,
    agentCallProviderAdapter: env.AGENT_CALL_PROVIDER_ADAPTER?.trim() || undefined,
    pstnBridgeBaseUrl: env.PSTN_BRIDGE_BASE_URL,
    pstnBridgeApiKey: env.PSTN_BRIDGE_API_KEY,
    pstnBridgeTimeoutMs: Number(env.PSTN_BRIDGE_TIMEOUT_MS ?? 10000),
    speechPipelineMode: parseSpeechPipelineMode(env.SPEECH_PIPELINE_MODE),
    domainLexiconPacks: parseDomainLexiconPacks(env.DOMAIN_LEXICON_PACKS),
    llmConfig: loadLlmConfig(env),
    duplexConfig: parseDuplexConfig(env),
  };
}

function parseDuplexConfig(
  env: Record<string, string | undefined>,
): CallDuplexConfig {
  return {
    enabled: parseBoolean(env.CALL_FULL_DUPLEX_ENABLED),
    minSpeechMs: boundedNumber(env.CALL_BARGE_IN_MIN_SPEECH_MS, 240, 80, 1000),
    minProbability: boundedNumber(
      env.CALL_BARGE_IN_MIN_PROBABILITY,
      0.5,
      0,
      1,
    ),
    cooldownMs: boundedNumber(env.CALL_BARGE_IN_COOLDOWN_MS, 800, 0, 5000),
    preRollMs: boundedNumber(env.CALL_BARGE_IN_PRE_ROLL_MS, 400, 0, 2000),
  };
}

function parseBoolean(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function boundedNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function parseSpeechPipelineMode(value: string | undefined): SpeechPipelineMode {
  if (!value || value === "cascade") return "cascade";
  if (value === "native" || value === "shadow") return value;
  throw new Error(`Unsupported SPEECH_PIPELINE_MODE: ${value}`);
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
