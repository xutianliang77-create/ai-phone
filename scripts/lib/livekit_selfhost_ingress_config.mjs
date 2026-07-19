import {
  isImmutableImage,
  isPort,
  record,
  yamlQuote,
} from "./livekit_selfhost_utils.mjs";

export const INGRESS_DEFAULTS = {
  LIVEKIT_INGRESS_ENABLED: "false",
  LIVEKIT_INGRESS_IMAGE: "",
  LIVEKIT_INGRESS_HEALTH_PORT: "7982",
  LIVEKIT_INGRESS_PROMETHEUS_PORT: "6791",
  LIVEKIT_INGRESS_RTMP_PORT: "1935",
  LIVEKIT_INGRESS_WHIP_PORT: "8080",
  LIVEKIT_INGRESS_HTTP_RELAY_PORT: "9090",
  LIVEKIT_INGRESS_REQUEST_TIMEOUT_SECONDS: "10",
  LIVEKIT_INGRESS_MAX_ACTIVE_PER_SESSION: "1",
  LIVEKIT_INGRESS_MAX_ACTIVE_TOTAL: "8",
  LIVEKIT_INGRESS_POLICY_VERSION: "external-media-v1",
  LIVEKIT_INGRESS_URL_INPUT_ENABLED: "false",
  LIVEKIT_INGRESS_PULL_URL_HOSTS: "",
  LIVEKIT_INGRESS_PULL_NETWORK_POLICY_ENFORCED: "false",
  LIVEKIT_INGRESS_SOURCE_PREFLIGHT_TIMEOUT_MS: "3000",
  LIVEKIT_INGRESS_SOURCE_MAX_REDIRECTS: "2",
};

export function validateLiveKitIngressEnv(env, checks, issues) {
  const flagOk = ["true", "false"].includes(env.LIVEKIT_INGRESS_ENABLED);
  record(checks, "LIVEKIT_INGRESS_ENABLED", flagOk, {
    enabled: env.LIVEKIT_INGRESS_ENABLED === "true",
  });
  if (!flagOk) {
    issues.push("LiveKit self-host invalid LIVEKIT_INGRESS_ENABLED");
    return;
  }
  if (env.LIVEKIT_INGRESS_ENABLED !== "true") return;
  const imageOk = isImmutableImage(env.LIVEKIT_INGRESS_IMAGE);
  record(checks, "LIVEKIT_INGRESS_IMAGE", imageOk, { digestPinned: imageOk });
  if (!imageOk) {
    issues.push("LiveKit self-host LIVEKIT_INGRESS_IMAGE must use tag and sha256 digest");
  }
  const portNames = [
    "LIVEKIT_INGRESS_HEALTH_PORT",
    "LIVEKIT_INGRESS_PROMETHEUS_PORT",
    "LIVEKIT_INGRESS_RTMP_PORT",
    "LIVEKIT_INGRESS_WHIP_PORT",
    "LIVEKIT_INGRESS_HTTP_RELAY_PORT",
  ];
  for (const name of portNames) {
    const ok = isPort(env[name]);
    record(checks, name, ok, { value: env[name] });
    if (!ok) issues.push(`LiveKit self-host invalid ${name}`);
  }
  const servicePorts = [
    env.LIVEKIT_HTTP_PORT,
    env.LIVEKIT_SIP_HEALTH_PORT,
    env.LIVEKIT_SIP_PROMETHEUS_PORT,
    env.LIVEKIT_EGRESS_HEALTH_PORT,
    env.LIVEKIT_EGRESS_PROMETHEUS_PORT,
    ...portNames.map((name) => env[name]),
  ];
  const distinct = new Set(servicePorts).size === servicePorts.length;
  record(checks, "LIVEKIT_INGRESS_PORTS_DISTINCT", distinct);
  if (!distinct) issues.push("LiveKit self-host Ingress ports must be distinct");
  for (const [name, min, max] of [
    ["LIVEKIT_INGRESS_REQUEST_TIMEOUT_SECONDS", 2, 30],
    ["LIVEKIT_INGRESS_MAX_ACTIVE_PER_SESSION", 1, 8],
    ["LIVEKIT_INGRESS_MAX_ACTIVE_TOTAL", 1, 100],
  ]) {
    const value = Number(env[name]);
    const ok = Number.isInteger(value) && value >= min && value <= max;
    record(checks, name, ok, { value });
    if (!ok) issues.push(`LiveKit self-host invalid ${name}`);
  }
  const policyOk = /^[A-Za-z0-9._-]{1,80}$/.test(env.LIVEKIT_INGRESS_POLICY_VERSION);
  record(checks, "LIVEKIT_INGRESS_POLICY_VERSION", policyOk);
  if (!policyOk) issues.push("LiveKit self-host invalid Ingress policy version");
  for (const name of [
    "LIVEKIT_INGRESS_URL_INPUT_ENABLED",
    "LIVEKIT_INGRESS_PULL_NETWORK_POLICY_ENFORCED",
  ]) {
    const ok = env[name] === "true" || env[name] === "false";
    record(checks, name, ok, { value: env[name] });
    if (!ok) issues.push(`LiveKit self-host invalid ${name}`);
  }
  for (const [name, minimum, maximum] of [
    ["LIVEKIT_INGRESS_SOURCE_PREFLIGHT_TIMEOUT_MS", 500, 10000],
    ["LIVEKIT_INGRESS_SOURCE_MAX_REDIRECTS", 0, 5],
  ]) {
    const value = Number(env[name]);
    const ok = Number.isInteger(value) && value >= minimum && value <= maximum;
    record(checks, name, ok, { value });
    if (!ok) issues.push(`LiveKit self-host invalid ${name}`);
  }
  if (env.LIVEKIT_INGRESS_URL_INPUT_ENABLED === "true") {
    const hostsOk = env.LIVEKIT_INGRESS_PULL_URL_HOSTS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .every((value) => /^[a-z0-9.-]+$/.test(value)) &&
      env.LIVEKIT_INGRESS_PULL_URL_HOSTS.trim().length > 0;
    record(checks, "LIVEKIT_INGRESS_PULL_URL_HOSTS", hostsOk);
    if (!hostsOk) issues.push("LiveKit self-host invalid Ingress pull URL hosts");
    if (env.LIVEKIT_INGRESS_PULL_NETWORK_POLICY_ENFORCED !== "true") {
      issues.push("LiveKit self-host URL Input requires enforced outbound network policy");
    }
  }
}

export function toLiveKitIngressConfig(env) {
  return {
    ingressEnabled: env.LIVEKIT_INGRESS_ENABLED === "true",
    ingressImage: env.LIVEKIT_INGRESS_IMAGE,
    ingressHealthPort: Number(env.LIVEKIT_INGRESS_HEALTH_PORT),
    ingressPrometheusPort: Number(env.LIVEKIT_INGRESS_PROMETHEUS_PORT),
    ingressRtmpPort: Number(env.LIVEKIT_INGRESS_RTMP_PORT),
    ingressWhipPort: Number(env.LIVEKIT_INGRESS_WHIP_PORT),
    ingressHttpRelayPort: Number(env.LIVEKIT_INGRESS_HTTP_RELAY_PORT),
    ingressRequestTimeoutSeconds: Number(env.LIVEKIT_INGRESS_REQUEST_TIMEOUT_SECONDS),
    ingressMaxActivePerSession: Number(env.LIVEKIT_INGRESS_MAX_ACTIVE_PER_SESSION),
    ingressMaxActiveTotal: Number(env.LIVEKIT_INGRESS_MAX_ACTIVE_TOTAL),
    ingressPolicyVersion: env.LIVEKIT_INGRESS_POLICY_VERSION,
    ingressUrlInputEnabled: env.LIVEKIT_INGRESS_URL_INPUT_ENABLED === "true",
    ingressPullUrlHosts: env.LIVEKIT_INGRESS_PULL_URL_HOSTS,
    ingressPullNetworkPolicyEnforced:
      env.LIVEKIT_INGRESS_PULL_NETWORK_POLICY_ENFORCED === "true",
    ingressSourcePreflightTimeoutMs:
      Number(env.LIVEKIT_INGRESS_SOURCE_PREFLIGHT_TIMEOUT_MS),
    ingressSourceMaxRedirects: Number(env.LIVEKIT_INGRESS_SOURCE_MAX_REDIRECTS),
  };
}

export function renderLiveKitIngressYaml(config) {
  return [
    `api_key: ${yamlQuote(config.apiKey)}`,
    `api_secret: ${yamlQuote(config.apiSecret)}`,
    `ws_url: ws://127.0.0.1:${config.httpPort}`,
    "redis:",
    "  address: 127.0.0.1:6379",
    `health_port: ${config.ingressHealthPort}`,
    `prometheus_port: ${config.ingressPrometheusPort}`,
    "log_level: info",
    `rtmp_port: ${config.ingressRtmpPort}`,
    `whip_port: ${config.ingressWhipPort}`,
    `http_relay_port: ${config.ingressHttpRelayPort}`,
    "",
  ].join("\n");
}

export function renderLiveKitIngressCompose(config) {
  if (!config.ingressEnabled) return "";
  return `
  ingress:
    image: ${config.ingressImage}
    network_mode: host
    restart: unless-stopped
    environment:
      INGRESS_CONFIG_FILE: /etc/ingress.yaml
    depends_on:
      - livekit
      - redis
    volumes:
      - ./ingress.yaml:/etc/ingress.yaml:ro
    healthcheck:
      test: ["CMD", "/bin/bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/${config.ingressHealthPort}"]
      interval: 10s
      timeout: 3s
      retries: 12
`;
}

export function renderLiveKitIngressReleaseEnv(config) {
  return `LIVEKIT_INGRESS_ENABLED=${config.ingressEnabled}
LIVEKIT_INGRESS_REQUEST_TIMEOUT_SECONDS=${config.ingressRequestTimeoutSeconds}
LIVEKIT_INGRESS_MAX_ACTIVE_PER_SESSION=${config.ingressMaxActivePerSession}
LIVEKIT_INGRESS_MAX_ACTIVE_TOTAL=${config.ingressMaxActiveTotal}
LIVEKIT_INGRESS_POLICY_VERSION=${config.ingressPolicyVersion}
LIVEKIT_INGRESS_URL_INPUT_ENABLED=${config.ingressUrlInputEnabled}
LIVEKIT_INGRESS_PULL_URL_HOSTS=${config.ingressPullUrlHosts ?? ""}
LIVEKIT_INGRESS_PULL_NETWORK_POLICY_ENFORCED=${config.ingressPullNetworkPolicyEnforced}
LIVEKIT_INGRESS_SOURCE_PREFLIGHT_TIMEOUT_MS=${config.ingressSourcePreflightTimeoutMs}
LIVEKIT_INGRESS_SOURCE_MAX_REDIRECTS=${config.ingressSourceMaxRedirects}
`;
}
