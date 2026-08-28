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
  voiceAgentBackgroundWorkEnabled: boolean;
  voiceAgentWorkRunnerEnabled: boolean;
  voiceAgentDeliveryCoordinatorEnabled: boolean;
  voiceAgentOwnershipEnabled: boolean;
  agentDeliveryCoordinatorOwner: string;
  agentDeliveryCoordinatorPollMs: number;
  agentDeliveryCoordinatorLeaseSeconds: number;
  agentDeliveryCoordinatorConcurrency: number;
  agentWorkRunnerOwner: string;
  agentWorkRunnerPollMs: number;
  agentWorkRunnerLeaseSeconds: number;
  agentWorkRunnerConcurrency: number;
  agentWorkToolGatewayUrl?: string;
  agentWorkToolGatewaySecret?: string;
  agentWorkToolGatewayTimeoutMs: number;
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
    voiceAgentBackgroundWorkEnabled:
      parseBoolean(process.env.VOICE_AGENT_BACKGROUND_WORK_ENABLED),
    voiceAgentWorkRunnerEnabled:
      parseBoolean(process.env.VOICE_AGENT_WORK_RUNNER_ENABLED),
    voiceAgentDeliveryCoordinatorEnabled:
      parseBoolean(process.env.VOICE_AGENT_DELIVERY_COORDINATOR_ENABLED),
    voiceAgentOwnershipEnabled:
      parseBoolean(process.env.VOICE_AGENT_OWNERSHIP_ENABLED),
    agentDeliveryCoordinatorOwner:
      process.env.AGENT_DELIVERY_COORDINATOR_OWNER?.trim() ||
      `agent-delivery-${process.env.HOSTNAME?.trim() || "local"}`,
    agentDeliveryCoordinatorPollMs: boundedInteger(
      process.env.AGENT_DELIVERY_COORDINATOR_POLL_MS,
      1_000,
      250,
      30_000,
    ),
    agentDeliveryCoordinatorLeaseSeconds: boundedInteger(
      process.env.AGENT_DELIVERY_COORDINATOR_LEASE_SECONDS,
      30,
      5,
      120,
    ),
    agentDeliveryCoordinatorConcurrency: boundedInteger(
      process.env.AGENT_DELIVERY_COORDINATOR_CONCURRENCY,
      2,
      1,
      8,
    ),
    agentWorkRunnerOwner: process.env.AGENT_WORK_RUNNER_OWNER?.trim() ||
      `agent-work-${process.env.HOSTNAME?.trim() || "local"}`,
    agentWorkRunnerPollMs: boundedInteger(
      process.env.AGENT_WORK_RUNNER_POLL_MS,
      1_000,
      250,
      30_000,
    ),
    agentWorkRunnerLeaseSeconds: boundedInteger(
      process.env.AGENT_WORK_RUNNER_LEASE_SECONDS,
      60,
      5,
      300,
    ),
    agentWorkRunnerConcurrency: boundedInteger(
      process.env.AGENT_WORK_RUNNER_CONCURRENCY,
      2,
      1,
      8,
    ),
    ...optionalHttpUrl("agentWorkToolGatewayUrl", "AGENT_WORK_TOOL_GATEWAY_URL"),
    ...optionalText(
      "agentWorkToolGatewaySecret",
      "AGENT_WORK_TOOL_GATEWAY_SECRET",
    ),
    agentWorkToolGatewayTimeoutMs: boundedInteger(
      process.env.AGENT_WORK_TOOL_GATEWAY_TIMEOUT_MS,
      20_000,
      1_000,
      60_000,
    ),
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
  return isEnabledEnvironmentValue(value);
}

export function isEnabledEnvironmentValue(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function optionalHttpUrl<Key extends string>(key: Key, name: string) {
  const value = process.env[name]?.trim();
  if (!value) return {};
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an HTTP URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) ||
    parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must be an HTTP URL without credentials or query`);
  }
  return { [key]: value.replace(/\/+$/, "") } as Record<Key, string>;
}

function optionalText<Key extends string>(key: Key, name: string) {
  const value = process.env[name]?.trim();
  return value ? { [key]: value } as Record<Key, string> : {};
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
