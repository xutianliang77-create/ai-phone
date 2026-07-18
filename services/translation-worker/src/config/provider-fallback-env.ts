export interface ProviderFallbackConfig {
  failureThreshold: number;
  cooldownMs: number;
}

export interface AsrFallbackRouteConfig {
  endpoint: string;
  flushEndpoint?: string;
  streamEndpoint?: string;
  apiKey?: string;
  timeoutMs: number;
  provider: string;
  model?: string;
}

export interface TranslationFallbackRouteConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  maxTokens: number;
  streaming: boolean;
  provider: string;
}

export interface TtsFallbackRouteConfig {
  endpoint: string;
  streamEndpoint?: string;
  warmupEndpoint?: string;
  apiKey?: string;
  timeoutMs: number;
  provider: string;
  model?: string;
}

export function parseProviderFallbackEnv(
  env: Record<string, string | undefined>,
) {
  return {
    providerFallback: {
      failureThreshold: boundedInteger(
        env.PROVIDER_FALLBACK_FAILURE_THRESHOLD,
        1,
        1,
        10,
      ),
      cooldownMs: boundedInteger(
        env.PROVIDER_FALLBACK_COOLDOWN_MS,
        30000,
        0,
        600000,
      ),
    },
    asrFallback: parseAsrFallback(env),
    translationFallback: parseTranslationFallback(env),
    ttsFallback: parseTtsFallback(env),
    llmFallbackCooldownMs: boundedInteger(
      env.LLM_FALLBACK_COOLDOWN_MS ?? env.PROVIDER_FALLBACK_COOLDOWN_MS,
      30000,
      0,
      600000,
    ),
  };
}

function parseAsrFallback(env: Record<string, string | undefined>) {
  const endpoint = env.ASR_FALLBACK_HTTP_ENDPOINT?.trim();
  if (!endpoint) return undefined;
  return {
    endpoint,
    ...optional("flushEndpoint", env.ASR_FALLBACK_HTTP_FLUSH_ENDPOINT),
    ...optional("streamEndpoint", env.ASR_FALLBACK_STREAM_ENDPOINT),
    ...optional("apiKey", env.ASR_FALLBACK_HTTP_API_KEY),
    timeoutMs: boundedInteger(env.ASR_FALLBACK_HTTP_TIMEOUT_MS, 10000, 100, 120000),
    provider: env.ASR_FALLBACK_PROVIDER?.trim() || "http_asr_fallback",
    ...optional("model", env.ASR_FALLBACK_MODEL),
  } satisfies AsrFallbackRouteConfig;
}

function parseTranslationFallback(env: Record<string, string | undefined>) {
  const baseUrl = env.TRANSLATION_FALLBACK_BASE_URL?.trim();
  const model = env.TRANSLATION_FALLBACK_MODEL?.trim();
  if (!baseUrl || !model) return undefined;
  return {
    baseUrl,
    model,
    ...optional("apiKey", env.TRANSLATION_FALLBACK_API_KEY),
    timeoutMs: boundedInteger(env.TRANSLATION_FALLBACK_TIMEOUT_MS, 20000, 100, 120000),
    maxTokens: boundedInteger(env.TRANSLATION_FALLBACK_MAX_TOKENS, 512, 16, 8192),
    streaming: env.TRANSLATION_FALLBACK_STREAMING_ENABLED?.trim().toLowerCase() ===
      "true",
    provider: env.TRANSLATION_FALLBACK_PROVIDER?.trim() || "openai_compatible_fallback",
  } satisfies TranslationFallbackRouteConfig;
}

function parseTtsFallback(env: Record<string, string | undefined>) {
  const endpoint = env.TTS_FALLBACK_HTTP_ENDPOINT?.trim();
  if (!endpoint) return undefined;
  return {
    endpoint,
    ...optional("streamEndpoint", env.TTS_FALLBACK_STREAM_ENDPOINT),
    ...optional("warmupEndpoint", env.TTS_FALLBACK_WARMUP_ENDPOINT),
    ...optional("apiKey", env.TTS_FALLBACK_HTTP_API_KEY),
    timeoutMs: boundedInteger(env.TTS_FALLBACK_HTTP_TIMEOUT_MS, 10000, 100, 120000),
    provider: env.TTS_FALLBACK_PROVIDER?.trim() || "http_tts_fallback",
    ...optional("model", env.TTS_FALLBACK_MODEL),
  } satisfies TtsFallbackRouteConfig;
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

function optional<K extends string>(key: K, value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? { [key]: trimmed } as Record<K, string> : {};
}
