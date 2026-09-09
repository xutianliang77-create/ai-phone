import type { IncomingMessage, ServerResponse } from "node:http";
import type { RealtimeEnv } from "../config/env.js";
import type { GatewayDependencyReadiness } from "./gateway-dependency-readiness.js";
import { publicProcessingReadiness } from "./public-processing-readiness.js";
import {
  gatewayRuntimeIdentity,
  gatewayRuntimeIdentityIssues,
  type GatewayRuntimeIdentity,
} from "./gateway-runtime-identity.js";

export interface GatewayHealthPayload {
  processingProfile?: "public_unqualified";
  legacyProviderIgnored?: boolean;
  status: "ok" | "degraded" | "unavailable";
  service: "realtime-gateway";
  version: "0.1.0";
  provider: RealtimeEnv["provider"];
  resolvedProvider: RealtimeEnv["resolvedProvider"];
  regionEdition: RealtimeEnv["regionEdition"];
  dataRegion: string;
  callProviderPolicy: string;
  complianceProfile: string;
  asrProvider: RealtimeEnv["asrProvider"];
  speakerProvider: RealtimeEnv["speakerProvider"];
  speakerEndpoint?: string;
  speakerTimeoutMs: number;
  asrEndpoint?: string;
  asrHealthUrl?: string;
  translationEndpoint?: string;
  translationModel?: string;
  sessionEventSink: RealtimeEnv["sessionEventSink"];
  tokenTransport: "subprotocol" | "subprotocol_with_legacy_query";
  publicEntryProtection: GatewayProtectionReadiness;
  dependencyReadiness?: GatewayDependencyReadiness;
  runtimeIdentity?: GatewayRuntimeIdentity;
  releaseReadiness: GatewayReleaseReadinessPayload;
}

export interface GatewayProtectionReadiness {
  status: "ready" | "not_ready";
  provider: string;
  issues: string[];
  [key: string]: unknown;
}

export interface GatewayReleaseReadinessPayload {
  status: "ready" | "not_ready";
  profile: RealtimeEnv["regionEdition"];
  issues: string[];
}

export function gatewayHealthPayload(
  env: RealtimeEnv,
  protection: GatewayProtectionReadiness = unconfiguredProtection(env),
  dependencies?: GatewayDependencyReadiness,
): GatewayHealthPayload {
  const runtimeIdentity = gatewayRuntimeIdentity(env);
  if (env.publicDeploymentId) dependencies = publicProcessingReadiness();
  return {
    ...(env.publicDeploymentId ? { processingProfile: "public_unqualified" as const,
      legacyProviderIgnored: true } : {}),
    status: dependencies?.status === "not_ready"
      ? "unavailable"
      : dependencies?.status === "degraded" ? "degraded" : "ok",
    service: "realtime-gateway",
    version: "0.1.0",
    provider: env.provider,
    resolvedProvider: env.resolvedProvider,
    regionEdition: env.regionEdition,
    dataRegion: env.dataRegion,
    callProviderPolicy: env.callProviderPolicy,
    complianceProfile: env.complianceProfile,
    asrProvider: env.asrProvider,
    speakerProvider: env.speakerProvider,
    speakerEndpoint: env.publicDeploymentId ? undefined : env.speakerHttpBaseUrl,
    speakerTimeoutMs: env.speakerHttpTimeoutMs,
    asrEndpoint: env.publicDeploymentId ? undefined : env.asrHttpEndpoint,
    asrHealthUrl: env.publicDeploymentId ? undefined : env.asrHttpHealthUrl,
    translationEndpoint: env.publicDeploymentId ? undefined : translationEndpoint(env),
    translationModel: env.publicDeploymentId ? undefined : translationModel(env),
    sessionEventSink: env.sessionEventSink,
    tokenTransport: env.allowQueryToken
      ? "subprotocol_with_legacy_query"
      : "subprotocol",
    publicEntryProtection: protection,
    ...(dependencies ? { dependencyReadiness: dependencies } : {}),
    ...(runtimeIdentity ? { runtimeIdentity } : {}),
    releaseReadiness: gatewayReleaseReadinessPayload(env, protection, dependencies),
  };
}

function translationEndpoint(env: RealtimeEnv) {
  if (env.provider === "qwen_live") return env.qwenBaseUrl;
  if (env.resolvedProvider === "lmstudio") return env.lmStudioBaseUrl;
  if (env.resolvedProvider === "openai") return env.openAiRealtimeEndpoint;
  return undefined;
}

function translationModel(env: RealtimeEnv) {
  if (env.provider === "qwen_live") return env.qwenModel;
  if (env.resolvedProvider === "lmstudio") return env.lmStudioModel;
  if (env.resolvedProvider === "openai") return env.openAiRealtimeModel;
  return undefined;
}

export function gatewayReleaseReadinessPayload(
  env: RealtimeEnv,
  protection?: GatewayProtectionReadiness,
  dependencies?: GatewayDependencyReadiness,
): GatewayReleaseReadinessPayload {
  const issues = gatewayReleaseReadinessIssues(env, protection, dependencies);
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    profile: env.regionEdition,
    issues,
  };
}

function gatewayReleaseReadinessIssues(
  env: RealtimeEnv,
  protection?: GatewayProtectionReadiness,
  dependencies?: GatewayDependencyReadiness,
) {
  const issues: string[] = [];
  if (env.publicDeploymentId) {
    dependencies = publicProcessingReadiness();
  } else {
    if (env.regionEdition === "domestic") appendDomesticProviderIssues(env, issues);
    if (env.provider === "tencent_trtc" || env.resolvedProvider === "unsupported") {
      issues.push("REALTIME_PROVIDER=tencent_trtc is not implemented for release");
    }
    appendAsrIssues(env, issues);
  }
  appendSessionSinkIssues(env, issues);
  if (env.allowQueryToken) {
    issues.push("Release requires REALTIME_ALLOW_QUERY_TOKEN=false");
  }
  if (env.publicRateLimitProvider !== "redis") {
    issues.push("Release requires PUBLIC_RATE_LIMIT_PROVIDER=redis");
  }
  if (!env.publicRateLimitRedisUrl) {
    issues.push("Release requires PUBLIC_RATE_LIMIT_REDIS_URL");
  }
  if (!env.publicRateLimitKeySecret) {
    issues.push("Release requires PUBLIC_RATE_LIMIT_KEY_SECRET");
  }
  if (protection?.status === "not_ready") issues.push(...protection.issues);
  if (dependencies && !dependencies.releaseReady) {
    issues.push(...dependencies.issues, ...dependencies.warnings);
  }
  issues.push(...gatewayRuntimeIdentityIssues(env));
  return issues;
}

function appendDomesticProviderIssues(env: RealtimeEnv, issues: string[]) {
  if (!["qwen_live", "self_hosted", "hymt2_self_hosted"].includes(env.provider)) {
    issues.push(
      "Domestic release requires REALTIME_PROVIDER=qwen_live, self_hosted, or hymt2_self_hosted",
    );
  }
  if (env.provider === "hymt2_self_hosted" && env.lmStudioModel !== "tencent/Hy-MT2-1.8B") {
    issues.push("TRANSLATION_MODEL must be tencent/Hy-MT2-1.8B for hymt2_self_hosted release");
  }
  if (env.provider !== "qwen_live") return;
  if (!env.qwenApiKey) issues.push("QWEN_API_KEY is required for qwen_live release");
  if (!env.qwenModel) issues.push("QWEN_MODEL is required for qwen_live release");
  if (!isHttpsUrl(env.qwenBaseUrl)) {
    issues.push("QWEN_BASE_URL must be an HTTPS OpenAI-compatible endpoint");
  }
}

function appendAsrIssues(env: RealtimeEnv, issues: string[]) {
  if (env.asrProvider !== "http") {
    issues.push("Release requires ASR_PROVIDER=http");
    return;
  }
  if (!env.asrHttpEndpoint) issues.push("ASR_HTTP_ENDPOINT is required for release");
  if (!env.asrHttpApiKey || env.asrHttpApiKey.length < 16) {
    issues.push("Release requires ASR_HTTP_API_KEY with at least 16 characters");
  }
}

function appendSessionSinkIssues(env: RealtimeEnv, issues: string[]) {
  if (env.sessionEventSink !== "api") {
    issues.push("Release requires SESSION_EVENT_SINK=api");
  }
  if (!env.internalApiSecret || env.internalApiSecret.length < 16) {
    issues.push("Release requires INTERNAL_API_SECRET with at least 16 characters");
  }
}

export function handleGatewayHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  env: RealtimeEnv,
  protection: GatewayProtectionReadiness = unconfiguredProtection(env),
  dependencies?: GatewayDependencyReadiness,
) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/health") {
    writeJson(
      response,
      200,
      gatewayHealthPayload(env, protection, dependencies),
      request.method === "HEAD",
    );
    return;
  }
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    url.pathname === "/health/release-ready"
  ) {
    const payload = gatewayReleaseReadinessPayload(env, protection, dependencies);
    writeJson(response, payload.status === "ready" ? 200 : 503, payload, request.method === "HEAD");
    return;
  }
  writeJson(response, 404, {
    error: { code: "not_found", message: "Not found" },
  }, request.method === "HEAD");
}

function unconfiguredProtection(env: RealtimeEnv): GatewayProtectionReadiness {
  const issues = [
    ...(env.publicRateLimitProvider === "redis" && !env.publicRateLimitRedisUrl
      ? ["PUBLIC_RATE_LIMIT_REDIS_URL is required"]
      : []),
    ...(env.publicRateLimitProvider === "redis" && !env.publicRateLimitKeySecret
      ? ["PUBLIC_RATE_LIMIT_KEY_SECRET is required"]
      : []),
  ];
  return {
    status: issues.length === 0 && env.publicRateLimitProvider === "memory"
      ? "ready"
      : "not_ready",
    provider: env.publicRateLimitProvider,
    issues,
  };
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  headOnly: boolean,
) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  if (headOnly) {
    response.end();
    return;
  }
  response.end(JSON.stringify(payload));
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
