import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";

export function getLiveKitIngressReadiness() {
  const room = getLiveKitRoomConfig();
  const enabled = process.env.LIVEKIT_INGRESS_ENABLED === "true";
  const urlInputEnabled = process.env.LIVEKIT_INGRESS_URL_INPUT_ENABLED === "true";
  const srtInputEnabled = process.env.LIVEKIT_INGRESS_SRT_ENABLED === "true";
  const srtBridgeConfigured = validBridgeUrl(
    process.env.SRT_INGRESS_BRIDGE_BASE_URL,
  ) && Buffer.byteLength(process.env.SRT_INGRESS_BRIDGE_API_KEY ?? "") >= 16;
  const pullUrlHosts = csv(process.env.LIVEKIT_INGRESS_PULL_URL_HOSTS);
  const srtRtmpAllowedHosts = csv(process.env.SRT_INGRESS_RTMP_ALLOWED_HOSTS);
  const srtPortMin = integer("SRT_INGRESS_PORT_MIN", 10_080);
  const srtPortMax = integer("SRT_INGRESS_PORT_MAX", 10_179);
  const srtMaxJobs = integer("SRT_INGRESS_MAX_JOBS", 4);
  const issues = [
    ...(enabled ? [] : ["Ingress requires LIVEKIT_INGRESS_ENABLED=true"]),
    ...(room.ok ? [] : room.issues),
    ...(integerIssues("LIVEKIT_INGRESS_REQUEST_TIMEOUT_SECONDS", 2, 30)),
    ...(integerIssues("LIVEKIT_INGRESS_MAX_ACTIVE_PER_SESSION", 1, 8)),
    ...(integerIssues("LIVEKIT_INGRESS_MAX_ACTIVE_TOTAL", 1, 100)),
    ...(process.env.LIVEKIT_INGRESS_POLICY_VERSION?.trim()
      ? []
      : ["LIVEKIT_INGRESS_POLICY_VERSION is required"]),
    ...(urlInputEnabled && pullUrlHosts.length === 0
      ? ["LIVEKIT_INGRESS_PULL_URL_HOSTS is required for URL input"]
      : []),
    ...(urlInputEnabled &&
        process.env.LIVEKIT_INGRESS_PULL_NETWORK_POLICY_ENFORCED !== "true"
      ? ["Ingress URL input requires enforced outbound network policy"]
      : []),
    ...(integerIssues("LIVEKIT_INGRESS_SOURCE_PREFLIGHT_TIMEOUT_MS", 500, 10_000)),
    ...(integerIssues("LIVEKIT_INGRESS_SOURCE_MAX_REDIRECTS", 0, 5)),
    ...(srtInputEnabled && !validBridgeUrl(process.env.SRT_INGRESS_BRIDGE_BASE_URL)
      ? ["SRT_INGRESS_BRIDGE_BASE_URL must be a loopback HTTP(S) URL"]
      : []),
    ...(srtInputEnabled && Buffer.byteLength(
        process.env.SRT_INGRESS_BRIDGE_API_KEY ?? "",
      ) < 16
      ? ["SRT_INGRESS_BRIDGE_API_KEY must be at least 16 bytes"]
      : []),
    ...(srtInputEnabled && !validAllowedHost(
        (process.env.SRT_INGRESS_PUBLIC_HOST ?? "").trim().toLowerCase(),
      )
      ? ["SRT_INGRESS_PUBLIC_HOST must be a valid hostname or IPv4 address"]
      : []),
    ...(srtInputEnabled && srtRtmpAllowedHosts.length === 0
      ? ["SRT_INGRESS_RTMP_ALLOWED_HOSTS is required for SRT input"]
      : []),
    ...(srtInputEnabled
      ? [
        ...integerIssues("SRT_INGRESS_PORT", 1, 65_535),
        ...integerIssues("SRT_INGRESS_PORT_MIN", 1_024, 65_535),
        ...integerIssues("SRT_INGRESS_PORT_MAX", 1_024, 65_535),
        ...integerIssues("SRT_INGRESS_MAX_JOBS", 1, 100),
        ...integerIssues("SRT_INGRESS_LATENCY_MS", 20, 8_000),
        ...integerIssues("SRT_INGRESS_MAX_DURATION_SECONDS", 60, 14_400),
        ...integerIssues("SRT_INGRESS_SHUTDOWN_GRACE_MS", 1_000, 60_000),
      ]
      : []),
    ...(srtInputEnabled && (srtPortMin > srtPortMax ||
        srtPortMax - srtPortMin + 1 < srtMaxJobs)
      ? ["SRT ingress port range must cover SRT_INGRESS_MAX_JOBS"]
      : []),
    ...(srtInputEnabled &&
        !(process.env.SRT_INGRESS_FFMPEG_PATH ?? "/usr/bin/ffmpeg").startsWith("/")
      ? ["SRT_INGRESS_FFMPEG_PATH must be absolute"]
      : []),
  ];
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    enabled,
    urlInputEnabled,
    srtInputEnabled,
    srtBridgeConfigured,
    pullUrlHosts,
    srtRtmpAllowedHosts,
    issues,
  };
}

export function getLiveKitIngressConfig() {
  const readiness = getLiveKitIngressReadiness();
  const room = getLiveKitRoomConfig();
  if (readiness.status !== "ready" || !room.ok) {
    return { ok: false as const, readiness };
  }
  return {
    ok: true as const,
    config: {
      ...room.config,
      requestTimeoutSeconds: integer("LIVEKIT_INGRESS_REQUEST_TIMEOUT_SECONDS", 10),
      maxActivePerSession: integer("LIVEKIT_INGRESS_MAX_ACTIVE_PER_SESSION", 1),
      maxActiveTotal: integer("LIVEKIT_INGRESS_MAX_ACTIVE_TOTAL", 8),
      policyVersion: process.env.LIVEKIT_INGRESS_POLICY_VERSION!,
      urlInputEnabled: readiness.urlInputEnabled,
      srtInputEnabled: readiness.srtInputEnabled,
      srtBridgeConfigured: readiness.srtBridgeConfigured,
      ...(readiness.srtBridgeConfigured
        ? {
          srtBridgeBaseUrl: process.env.SRT_INGRESS_BRIDGE_BASE_URL!.replace(/\/$/, ""),
          srtBridgeApiKey: process.env.SRT_INGRESS_BRIDGE_API_KEY!,
        }
        : {}),
      pullUrlHosts: readiness.pullUrlHosts,
      sourcePreflightTimeoutMs: integer("LIVEKIT_INGRESS_SOURCE_PREFLIGHT_TIMEOUT_MS", 3_000),
      sourceMaxRedirects: integer("LIVEKIT_INGRESS_SOURCE_MAX_REDIRECTS", 2),
    },
  };
}

function validBridgeUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    return (url.protocol === "http:" || url.protocol === "https:") &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      !url.username && !url.password && !url.hash && !url.search &&
      url.pathname === "/";
  } catch {
    return false;
  }
}

function integerIssues(name: string, min: number, max: number) {
  const value = integer(name, min);
  return value >= min && value <= max ? [] : [`${name} must be ${min}-${max}`];
}

function integer(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) ? value : fallback;
}

function csv(value: string | undefined) {
  return (value ?? "").split(",").map((item) => item.trim().toLowerCase())
    .filter(validAllowedHost);
}

function validAllowedHost(value: string) {
  if (value.length > 253 || !value.includes(".") || value.includes("..")) return false;
  return value.split(".").every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  );
}
