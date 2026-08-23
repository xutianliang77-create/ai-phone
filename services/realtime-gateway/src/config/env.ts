import { mergeModelRoutingEnv } from "./model-routing-env.js";
import {
  parseDomainLexiconPacks,
  type DomainLexiconPack,
} from "../domain/domain-lexicon.js";
import {
  boundedInteger,
  commaSeparated,
  parseAsrProviderName,
  parseBoolean,
  parseLlmProviderName,
  parseProviderName,
  parseRateLimitProvider,
  parseRegionEdition,
  parseSessionEventSinkName,
  resolveProviderName,
  type AsrProviderName,
  type LlmProviderName,
  type RealtimeProviderName,
  type RegionEdition,
  type ResolvedRealtimeProviderName,
  type SessionEventSinkName,
  type SpeakerProviderName,
} from "./env-parsers.js";

export type {
  AsrProviderName,
  LlmProviderName,
  RealtimeProviderName,
  RegionEdition,
  SessionEventSinkName,
  SpeakerProviderName,
} from "./env-parsers.js";

export interface RealtimeEnv {
  host: string;
  port: number;
  allowedHosts: string[];
  allowedOrigins: string[];
  allowNonBrowserClientsWithoutOrigin: boolean;
  trustProxyAddresses: string[];
  maxPayloadBytes: number;
  maxConnections: number;
  maxConnectionsPerIp: number;
  maxSessions: number;
  maxMessagesPerSecond: number;
  maxAudioFramesPerSecond: number;
  maxPendingAudioMs: number;
  listeningMaxContinuationBufferMs: number;
  maxPendingControlEvents: number;
  maxPendingTtsOutputs: number;
  handshakeRateLimitPerMinute: number;
  publicRateLimitProvider: "memory" | "redis";
  publicRateLimitRedisUrl?: string;
  publicRateLimitKeyPrefix: string;
  publicRateLimitKeySecret: string;
  publicRateLimitConnectTimeoutMs: number;
  realtimeTokenSecret: string;
  allowQueryToken?: boolean;
  provider: RealtimeProviderName;
  resolvedProvider: ResolvedRealtimeProviderName;
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
  ttsHttpStreamEndpoint?: string;
  ttsHttpApiKey?: string;
  ttsHttpTimeoutMs: number;
  ttsStreamPrefillMs: number;
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
  const publicRateLimitProvider = parseRateLimitProvider(
    env.PUBLIC_RATE_LIMIT_PROVIDER,
  );
  return {
    host: env.REALTIME_BIND_HOST?.trim() || "0.0.0.0",
    port: Number(env.REALTIME_PORT ?? 3001),
    allowedHosts: commaSeparated(env.REALTIME_ALLOWED_HOSTS),
    allowedOrigins: commaSeparated(env.REALTIME_ALLOWED_ORIGINS),
    allowNonBrowserClientsWithoutOrigin: parseBoolean(
      env.REALTIME_ALLOW_NON_BROWSER_CLIENTS_WITHOUT_ORIGIN,
      false,
    ),
    trustProxyAddresses: commaSeparated(
      env.REALTIME_TRUST_PROXY_ADDRESSES ?? "127.0.0.1,::1",
    ),
    maxPayloadBytes: boundedInteger(
      env.REALTIME_MAX_PAYLOAD_BYTES,
      64 * 1024,
      8 * 1024,
      1024 * 1024,
    ),
    maxConnections: boundedInteger(
      env.REALTIME_MAX_CONNECTIONS,
      512,
      1,
      10_000,
    ),
    maxConnectionsPerIp: boundedInteger(
      env.REALTIME_MAX_CONNECTIONS_PER_IP,
      8,
      1,
      100,
    ),
    maxSessions: boundedInteger(env.REALTIME_MAX_SESSIONS, 256, 1, 5000),
    maxMessagesPerSecond: boundedInteger(
      env.REALTIME_MAX_MESSAGES_PER_SECOND,
      120,
      10,
      1000,
    ),
    maxAudioFramesPerSecond: boundedInteger(
      env.REALTIME_MAX_AUDIO_FRAMES_PER_SECOND,
      75,
      10,
      250,
    ),
    maxPendingAudioMs: boundedInteger(
      env.REALTIME_MAX_PENDING_AUDIO_MS,
      6000,
      500,
      30_000,
    ),
    listeningMaxContinuationBufferMs: boundedInteger(
      env.REALTIME_LISTENING_MAX_CONTINUATION_BUFFER_MS,
      5000,
      250,
      5000,
    ),
    maxPendingControlEvents: boundedInteger(
      env.REALTIME_MAX_PENDING_CONTROL_EVENTS,
      32,
      1,
      256,
    ),
    maxPendingTtsOutputs: boundedInteger(
      env.REALTIME_MAX_PENDING_TTS_OUTPUTS,
      32,
      1,
      256,
    ),
    handshakeRateLimitPerMinute: boundedInteger(
      env.REALTIME_HANDSHAKE_RATE_LIMIT_PER_MINUTE,
      30,
      1,
      600,
    ),
    publicRateLimitProvider,
    publicRateLimitRedisUrl: env.PUBLIC_RATE_LIMIT_REDIS_URL,
    publicRateLimitKeyPrefix:
      env.PUBLIC_RATE_LIMIT_KEY_PREFIX ?? "wujie:gateway:public",
    publicRateLimitKeySecret:
      env.PUBLIC_RATE_LIMIT_KEY_SECRET ??
      (publicRateLimitProvider === "memory" ? "local-development-only" : ""),
    publicRateLimitConnectTimeoutMs: boundedInteger(
      env.PUBLIC_RATE_LIMIT_CONNECT_TIMEOUT_MS,
      1500,
      250,
      10_000,
    ),
    realtimeTokenSecret: env.REALTIME_TOKEN_SECRET ?? "dev-secret",
    allowQueryToken: parseBoolean(
      env.REALTIME_ALLOW_QUERY_TOKEN,
      process.env.NODE_ENV !== "production",
    ),
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
    ttsHttpStreamEndpoint: env.TTS_HTTP_STREAM_ENDPOINT,
    ttsHttpApiKey: env.TTS_HTTP_API_KEY,
    ttsHttpTimeoutMs: Number(env.TTS_HTTP_TIMEOUT_MS ?? 30_000),
    ttsStreamPrefillMs: boundedInteger(
      env.TTS_STREAM_PREFILL_MS,
      800,
      200,
      2000,
    ),
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
