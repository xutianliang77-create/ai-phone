export interface ApiEnv {
  apiHost: string;
  apiPort: number;
  apiBodyLimitBytes: number;
  corsAllowedOrigins: string[];
  trustProxyAddresses: string[];
  publicRateLimitProvider: "memory" | "redis";
  publicRateLimitRedisUrl?: string;
  publicRateLimitKeyPrefix: string;
  publicRateLimitKeySecret: string;
  publicRateLimitConnectTimeoutMs: number;
  realtimeTokenSecret: string;
  realtimeWsEndpoint: string;
  publicCallBaseUrl: string;
  regionEdition: "domestic" | "international";
  dataRegion: string;
  callProviderPolicy: string;
  complianceProfile: string;
  realtimeStaleSessionGraceSeconds: number;
  realtimeStaleSessionSweepSeconds: number;
  livekitSipReconciliationGraceSeconds: number;
  callFullDuplexEnabled: boolean;
}

export function loadEnv(): ApiEnv {
  const regionEdition = parseRegionEdition(process.env.REGION_EDITION);
  const publicCallBaseUrl = process.env.PUBLIC_CALL_BASE_URL ??
    "https://call.translation.local";
  const publicRateLimitProvider = parseRateLimitProvider(
    process.env.PUBLIC_RATE_LIMIT_PROVIDER,
  );
  return {
    apiHost: process.env.API_BIND_HOST?.trim() || "0.0.0.0",
    apiPort: Number(process.env.API_PORT ?? 3000),
    apiBodyLimitBytes: boundedInteger(
      process.env.API_BODY_LIMIT_BYTES,
      16 * 1024 * 1024,
      64 * 1024,
      20 * 1024 * 1024,
    ),
    corsAllowedOrigins: allowedOrigins(
      process.env.API_CORS_ALLOWED_ORIGINS,
      publicCallBaseUrl,
    ),
    trustProxyAddresses: commaSeparated(
      process.env.API_TRUST_PROXY_ADDRESSES ?? "127.0.0.1,::1",
    ),
    publicRateLimitProvider,
    publicRateLimitRedisUrl: process.env.PUBLIC_RATE_LIMIT_REDIS_URL,
    publicRateLimitKeyPrefix:
      process.env.PUBLIC_RATE_LIMIT_KEY_PREFIX ?? "wujie:api:public",
    publicRateLimitKeySecret:
      process.env.PUBLIC_RATE_LIMIT_KEY_SECRET ??
      (publicRateLimitProvider === "memory" ? "local-development-only" : ""),
    publicRateLimitConnectTimeoutMs: boundedInteger(
      process.env.PUBLIC_RATE_LIMIT_CONNECT_TIMEOUT_MS,
      1500,
      250,
      10_000,
    ),
    realtimeTokenSecret: process.env.REALTIME_TOKEN_SECRET ?? "dev-secret",
    realtimeWsEndpoint: process.env.REALTIME_WS_ENDPOINT ?? "ws://localhost:3001/realtime",
    publicCallBaseUrl,
    regionEdition,
    dataRegion: process.env.DATA_REGION ?? (regionEdition === "domestic" ? "cn" : "us"),
    callProviderPolicy:
      process.env.CALL_PROVIDER_POLICY ??
      (regionEdition === "domestic" ? "call_link_only" : "pstn_enabled"),
    complianceProfile:
      process.env.COMPLIANCE_PROFILE ??
      (regionEdition === "domestic" ? "pipl" : "us_ca"),
    realtimeStaleSessionGraceSeconds: positiveNumber(
      process.env.REALTIME_STALE_SESSION_GRACE_SECONDS,
      300,
    ),
    realtimeStaleSessionSweepSeconds: positiveNumber(
      process.env.REALTIME_STALE_SESSION_SWEEP_SECONDS,
      30,
    ),
    livekitSipReconciliationGraceSeconds: positiveNumber(
      process.env.LIVEKIT_SIP_RECONCILIATION_GRACE_SECONDS,
      30,
    ),
    callFullDuplexEnabled: parseBoolean(process.env.CALL_FULL_DUPLEX_ENABLED),
  };
}

function parseRateLimitProvider(value: string | undefined): "memory" | "redis" {
  if (value === "redis") return "redis";
  if (value === "memory") return "memory";
  return process.env.NODE_ENV === "production" ? "redis" : "memory";
}

function allowedOrigins(value: string | undefined, publicCallBaseUrl: string) {
  const origins = new Set(commaSeparated(value));
  try {
    origins.add(new URL(publicCallBaseUrl).origin);
  } catch {
    // Existing call-room readiness reports malformed public URLs.
  }
  origins.delete("*");
  return [...origins];
}

function commaSeparated(value: string | undefined) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function parseBoolean(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function parseRegionEdition(value: string | undefined): ApiEnv["regionEdition"] {
  return value === "international" ? "international" : "domestic";
}
