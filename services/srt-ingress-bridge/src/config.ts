export interface SrtIngressBridgeConfig {
  apiKey: string;
  bindHost: string;
  ffmpegPath: string;
  healthPort: number;
  latencyMs: number;
  maxDurationSeconds: number;
  maxJobs: number;
  portMax: number;
  portMin: number;
  publicHost: string;
  rtmpAllowedHosts: string[];
  shutdownGraceMs: number;
}

export function loadSrtIngressBridgeConfig(
  env: NodeJS.ProcessEnv = process.env,
): SrtIngressBridgeConfig {
  const config = {
    apiKey: required(env, "SRT_INGRESS_BRIDGE_API_KEY"),
    bindHost: env.SRT_INGRESS_BIND_HOST?.trim() || "127.0.0.1",
    ffmpegPath: env.SRT_INGRESS_FFMPEG_PATH?.trim() || "/usr/bin/ffmpeg",
    healthPort: integer(env, "SRT_INGRESS_PORT", 3310, 1, 65_535),
    latencyMs: integer(env, "SRT_INGRESS_LATENCY_MS", 200, 20, 8_000),
    maxDurationSeconds: integer(
      env,
      "SRT_INGRESS_MAX_DURATION_SECONDS",
      7_200,
      60,
      14_400,
    ),
    maxJobs: integer(env, "SRT_INGRESS_MAX_JOBS", 4, 1, 100),
    portMax: integer(env, "SRT_INGRESS_PORT_MAX", 10_179, 1_024, 65_535),
    portMin: integer(env, "SRT_INGRESS_PORT_MIN", 10_080, 1_024, 65_535),
    publicHost: required(env, "SRT_INGRESS_PUBLIC_HOST").toLowerCase(),
    rtmpAllowedHosts: csv(required(env, "SRT_INGRESS_RTMP_ALLOWED_HOSTS")),
    shutdownGraceMs: integer(
      env,
      "SRT_INGRESS_SHUTDOWN_GRACE_MS",
      10_000,
      1_000,
      60_000,
    ),
  } satisfies SrtIngressBridgeConfig;
  const issues = configIssues(config);
  if (issues.length > 0) throw new Error(issues.join("; "));
  return config;
}

export function configIssues(config: SrtIngressBridgeConfig) {
  const issues: string[] = [];
  if (Buffer.byteLength(config.apiKey) < 16) {
    issues.push("SRT_INGRESS_BRIDGE_API_KEY must be at least 16 bytes");
  }
  if (!validHost(config.bindHost)) {
    issues.push("SRT_INGRESS_BIND_HOST must be a hostname or IPv4 address");
  }
  if (!validHost(config.publicHost)) {
    issues.push("SRT_INGRESS_PUBLIC_HOST must be a hostname or IPv4 address");
  }
  if (config.rtmpAllowedHosts.length === 0 ||
    config.rtmpAllowedHosts.some((host) => !validHost(host))) {
    issues.push("SRT_INGRESS_RTMP_ALLOWED_HOSTS must contain exact valid hosts");
  }
  if (config.portMin > config.portMax) {
    issues.push("SRT_INGRESS_PORT_MIN must not exceed SRT_INGRESS_PORT_MAX");
  }
  if (config.portMax - config.portMin + 1 < config.maxJobs) {
    issues.push("SRT ingress port range must cover SRT_INGRESS_MAX_JOBS");
  }
  if (!config.ffmpegPath.startsWith("/")) {
    issues.push("SRT_INGRESS_FFMPEG_PATH must be absolute");
  }
  return issues;
}

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function csv(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim().toLowerCase())
    .filter(Boolean))];
}

function validHost(value: string) {
  return value.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) &&
    !value.includes("..") && !value.startsWith(".") && !value.endsWith(".");
}
