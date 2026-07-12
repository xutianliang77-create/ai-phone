import { mergeModelRoutingEnv } from "./model-routing-env.js";
import {
  parseDomainLexiconPacks,
  type DomainLexiconPack,
} from "../domain/domain-lexicon.js";

export type RealtimeProviderName =
  | "mock"
  | "openai"
  | "lmstudio"
  | "self_hosted"
  | "hymt2_self_hosted"
  | "qwen_live"
  | "tencent_trtc";
export type AsrProviderName = "mock" | "http";
export type SpeakerProviderName = "off" | "http";
export type SessionEventSinkName = "noop" | "api";
export type RegionEdition = "domestic" | "international";
export type LlmProviderName = "off" | "mock" | "openai_compatible";

export interface RealtimeEnv {
  port: number;
  realtimeTokenSecret: string;
  provider: RealtimeProviderName;
  resolvedProvider: "mock" | "openai" | "lmstudio" | "qwen_live" | "unsupported";
  regionEdition: RegionEdition;
  dataRegion: string;
  callProviderPolicy: string;
  complianceProfile: string;
  asrProvider: AsrProviderName;
  speakerProvider: SpeakerProviderName;
  openAiApiKey?: string;
  openAiRealtimeEndpoint: string;
  openAiRealtimeModel: string;
  openAiInputTranscriptionModel: string;
  openAiConnectTimeoutMs: number;
  lmStudioBaseUrl: string;
  lmStudioModel: string;
  lmStudioApiKey?: string;
  lmStudioTimeoutMs: number;
  lmStudioMaxTokens: number;
  qwenBaseUrl: string;
  qwenModel: string;
  qwenApiKey?: string;
  qwenTimeoutMs: number;
  qwenMaxTokens: number;
  asrHttpEndpoint?: string;
  asrHttpFlushEndpoint?: string;
  asrHttpHealthUrl?: string;
  asrHttpApiKey?: string;
  asrHttpTimeoutMs: number;
  speakerHttpBaseUrl?: string;
  speakerHttpApiKey?: string;
  speakerHttpTimeoutMs: number;
  ttsHttpEndpoint?: string;
  ttsHttpApiKey?: string;
  ttsHttpTimeoutMs: number;
  sessionEventSink: SessionEventSinkName;
  apiBaseUrl: string;
  internalApiSecret?: string;
  sessionSyncTimeoutMs: number;
  disconnectGraceMs: number;
  heartbeatIntervalMs: number;
  llmProvider: LlmProviderName;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmCorrectionModel?: string;
  llmReviewModel?: string;
  llmRefinementEnabled: boolean;
  llmReviewEnabled: boolean;
  llmCorrectionTimeoutMs: number;
  llmReviewTimeoutMs: number;
  llmCorrectionMaxTokens: number;
  llmReviewMaxTokens: number;
  llmTemperature: number;
  llmReasoningEffort?: string | null;
  llmMinConfidence: number;
  domainLexiconPacks: DomainLexiconPack[];
}

export function loadEnv(): RealtimeEnv {
  const env = mergeModelRoutingEnv("gateway");
  const provider = parseProviderName(env.REALTIME_PROVIDER);
  const regionEdition = parseRegionEdition(env.REGION_EDITION);
  return {
    port: Number(env.REALTIME_PORT ?? 3001),
    realtimeTokenSecret: env.REALTIME_TOKEN_SECRET ?? "dev-secret",
    provider,
    resolvedProvider: resolveProviderName(provider),
    regionEdition,
    dataRegion: env.DATA_REGION ?? (regionEdition === "domestic" ? "cn" : "us"),
    callProviderPolicy:
      env.CALL_PROVIDER_POLICY ??
      (regionEdition === "domestic" ? "call_link_only" : "pstn_enabled"),
    complianceProfile:
      env.COMPLIANCE_PROFILE ??
      (regionEdition === "domestic" ? "pipl" : "us_ca"),
    asrProvider: parseAsrProviderName(env.ASR_PROVIDER),
    speakerProvider: env.SPEAKER_PROVIDER === "http" ? "http" : "off",
    openAiApiKey: env.OPENAI_API_KEY,
    openAiRealtimeEndpoint:
      env.OPENAI_REALTIME_ENDPOINT ??
      "wss://api.openai.com/v1/realtime/translations",
    openAiRealtimeModel:
      env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-translate",
    openAiInputTranscriptionModel:
      env.OPENAI_INPUT_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe",
    openAiConnectTimeoutMs: Number(env.OPENAI_CONNECT_TIMEOUT_MS ?? 10_000),
    lmStudioBaseUrl:
      env.TRANSLATION_BASE_URL ??
      env.LMSTUDIO_BASE_URL ??
      "http://127.0.0.1:1234",
    lmStudioModel:
      env.TRANSLATION_MODEL ??
      env.LMSTUDIO_MODEL ??
      "tencent/Hy-MT2-1.8B",
    lmStudioApiKey: env.TRANSLATION_API_KEY ?? env.LMSTUDIO_API_KEY,
    lmStudioTimeoutMs: Number(
      env.TRANSLATION_TIMEOUT_MS ??
        env.LMSTUDIO_TIMEOUT_MS ??
        20_000,
    ),
    lmStudioMaxTokens: Number(
      env.TRANSLATION_MAX_TOKENS ??
        env.LMSTUDIO_MAX_TOKENS ??
        512,
    ),
    qwenBaseUrl:
      env.QWEN_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
    qwenModel: env.QWEN_MODEL ?? "qwen-plus",
    qwenApiKey: env.QWEN_API_KEY,
    qwenTimeoutMs: Number(env.QWEN_TIMEOUT_MS ?? 20_000),
    qwenMaxTokens: Number(env.QWEN_MAX_TOKENS ?? 512),
    asrHttpEndpoint: env.ASR_HTTP_ENDPOINT,
    asrHttpFlushEndpoint: env.ASR_HTTP_FLUSH_ENDPOINT,
    asrHttpHealthUrl: env.ASR_HTTP_HEALTH_URL,
    asrHttpApiKey: env.ASR_HTTP_API_KEY,
    asrHttpTimeoutMs: Number(env.ASR_HTTP_TIMEOUT_MS ?? 10_000),
    speakerHttpBaseUrl: env.SPEAKER_HTTP_BASE_URL,
    speakerHttpApiKey: env.SPEAKER_HTTP_API_KEY,
    speakerHttpTimeoutMs: Number(env.SPEAKER_HTTP_TIMEOUT_MS ?? 2000),
    ttsHttpEndpoint: env.TTS_HTTP_ENDPOINT,
    ttsHttpApiKey: env.TTS_HTTP_API_KEY,
    ttsHttpTimeoutMs: Number(env.TTS_HTTP_TIMEOUT_MS ?? 30_000),
    sessionEventSink: parseSessionEventSinkName(env.SESSION_EVENT_SINK),
    apiBaseUrl: env.API_BASE_URL ?? "http://127.0.0.1:3100",
    internalApiSecret: env.INTERNAL_API_SECRET,
    sessionSyncTimeoutMs: Number(env.SESSION_SYNC_TIMEOUT_MS ?? 5_000),
    disconnectGraceMs: Number(env.REALTIME_DISCONNECT_GRACE_MS ?? 45_000),
    heartbeatIntervalMs: Number(env.REALTIME_HEARTBEAT_INTERVAL_MS ?? 15_000),
    llmProvider: parseLlmProviderName(env.LLM_PROVIDER),
    llmBaseUrl: env.LLM_BASE_URL ?? env.SUMMARY_BASE_URL,
    llmApiKey: env.LLM_API_KEY ?? env.SUMMARY_API_KEY,
    llmCorrectionModel: env.LLM_CORRECTION_MODEL ?? env.LLM_MODEL,
    llmReviewModel: env.LLM_REVIEW_MODEL ?? env.SUMMARY_MODEL ?? env.LLM_MODEL,
    llmRefinementEnabled: parseBoolean(env.LLM_REFINEMENT_ENABLED, false),
    llmReviewEnabled: parseBoolean(
      env.LLM_REVIEW_ENABLED,
      env.SESSION_REVIEW_PROVIDER === "openai_compatible",
    ),
    llmCorrectionTimeoutMs: Number(env.LLM_CORRECTION_TIMEOUT_MS ?? 2500),
    llmReviewTimeoutMs: Number(env.LLM_REVIEW_TIMEOUT_MS ?? 30_000),
    llmCorrectionMaxTokens: Number(env.LLM_CORRECTION_MAX_TOKENS ?? 384),
    llmReviewMaxTokens: Number(env.LLM_REVIEW_MAX_TOKENS ?? env.SUMMARY_MAX_TOKENS ?? 2048),
    llmTemperature: Number(env.LLM_TEMPERATURE ?? 0),
    llmReasoningEffort: env.LLM_REASONING_EFFORT ?? "none",
    llmMinConfidence: Number(env.LLM_MIN_CONFIDENCE ?? 0.72),
    domainLexiconPacks: parseDomainLexiconPacks(env.DOMAIN_LEXICON_PACKS),
  };
}

function parseProviderName(value: string | undefined): RealtimeProviderName {
  if (value === "self_hosted") return "self_hosted";
  if (value === "hymt2_self_hosted") return "hymt2_self_hosted";
  if (value === "qwen_live") return "qwen_live";
  if (value === "tencent_trtc") return "tencent_trtc";
  if (value === "lmstudio") return "lmstudio";
  return value === "openai" ? "openai" : "mock";
}

function resolveProviderName(
  provider: RealtimeProviderName,
): RealtimeEnv["resolvedProvider"] {
  if (provider === "self_hosted" || provider === "hymt2_self_hosted") {
    return "lmstudio";
  }
  if (provider === "qwen_live") return "qwen_live";
  if (provider === "tencent_trtc") return "unsupported";
  return provider;
}

function parseRegionEdition(value: string | undefined): RegionEdition {
  return value === "international" ? "international" : "domestic";
}

function parseAsrProviderName(value: string | undefined): AsrProviderName {
  return value === "http" ? "http" : "mock";
}

function parseSessionEventSinkName(value: string | undefined): SessionEventSinkName {
  return value === "api" ? "api" : "noop";
}

function parseLlmProviderName(value: string | undefined): LlmProviderName {
  if (value === "mock" || value === "openai_compatible") return value;
  return "off";
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}
