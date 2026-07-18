import {
  callRoomResourceLimitIssues,
  getCallRoomResourceLimits,
  type CallRoomResourceLimits,
} from "./call-room-resource-limits.js";

export interface CallRoomReadiness {
  status: "ready" | "not_ready";
  provider: string;
  livekit: {
    url: "configured" | "configuration_required";
    apiKey: "configured" | "configuration_required";
    apiSecret: "configured" | "configuration_required";
    tokenTtlSeconds: number;
  };
  internalApi: {
    secret: "configured" | "configuration_required";
  };
  resourceLimits: CallRoomResourceLimits;
  issues: string[];
}

export interface LiveKitRoomConfig {
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
  tokenTtlSeconds: number;
  resourceLimits: CallRoomResourceLimits;
}

const defaultTokenTtlSeconds = 120;
const maxTokenTtlSeconds = 300;

export function getCallRoomReadiness(): CallRoomReadiness {
  const provider = callRoomProvider();
  const livekitUrl = liveKitUrl();
  const tokenTtlSeconds = parseTokenTtlSeconds();
  const issues = [
    ...providerIssues(provider),
    ...liveKitIssues(livekitUrl),
    ...internalApiIssues(),
    ...tokenTtlIssues(),
    ...callRoomResourceLimitIssues(),
  ];
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    provider,
    livekit: {
      url: livekitUrl ? "configured" : "configuration_required",
      apiKey: process.env.LIVEKIT_API_KEY
        ? "configured"
        : "configuration_required",
      apiSecret: process.env.LIVEKIT_API_SECRET
        ? "configured"
        : "configuration_required",
      tokenTtlSeconds,
    },
    internalApi: {
      secret: hasStrongInternalSecret()
        ? "configured"
        : "configuration_required",
    },
    resourceLimits: getCallRoomResourceLimits(),
    issues,
  };
}

export function getLiveKitRoomConfig():
  { ok: true; config: LiveKitRoomConfig } | { ok: false; issues: string[] } {
  const readiness = getCallRoomReadiness();
  if (readiness.status !== "ready") {
    return { ok: false, issues: readiness.issues };
  }
  return {
    ok: true,
    config: {
      livekitUrl: liveKitUrl(),
      apiKey: process.env.LIVEKIT_API_KEY ?? "",
      apiSecret: process.env.LIVEKIT_API_SECRET ?? "",
      tokenTtlSeconds: readiness.livekit.tokenTtlSeconds,
      resourceLimits: readiness.resourceLimits,
    },
  };
}

function callRoomProvider() {
  return process.env.CALL_ROOM_PROVIDER?.trim() || "livekit";
}

function liveKitUrl() {
  return (process.env.LIVEKIT_URL ?? process.env.LIVEKIT_WS_URL ?? "").trim();
}

function providerIssues(provider: string) {
  if (provider === "livekit") return [];
  if (provider === "mock")
    return ["call room provider mock is not release-ready"];
  return [`call room invalid CALL_ROOM_PROVIDER ${provider}`];
}

function liveKitIssues(livekitUrl: string) {
  const issues: string[] = [];
  if (!livekitUrl) {
    issues.push("livekit missing LIVEKIT_URL");
  } else if (!isAllowedLiveKitUrl(livekitUrl)) {
    issues.push("livekit invalid LIVEKIT_URL");
  }
  if (!process.env.LIVEKIT_API_KEY)
    issues.push("livekit missing LIVEKIT_API_KEY");
  if (!process.env.LIVEKIT_API_SECRET)
    issues.push("livekit missing LIVEKIT_API_SECRET");
  return issues;
}

function internalApiIssues() {
  return hasStrongInternalSecret()
    ? []
    : ["call room requires INTERNAL_API_SECRET"];
}

function tokenTtlIssues() {
  return isAllowedTokenTtl(process.env.CALL_ROOM_TOKEN_TTL_SECONDS)
    ? []
    : [`call room CALL_ROOM_TOKEN_TTL_SECONDS must be 1-${maxTokenTtlSeconds}`];
}

function parseTokenTtlSeconds() {
  const value = process.env.CALL_ROOM_TOKEN_TTL_SECONDS;
  if (!value) return defaultTokenTtlSeconds;
  return isAllowedTokenTtl(value) ? Number(value) : defaultTokenTtlSeconds;
}

function hasStrongInternalSecret() {
  return (process.env.INTERNAL_API_SECRET ?? "").trim().length >= 16;
}

function isAllowedLiveKitUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:", "wss:", "ws:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function isAllowedTokenTtl(value: string | undefined) {
  if (value === undefined || value.length === 0) return true;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maxTokenTtlSeconds;
}
