import {
  hasRealValue,
  isImmutableImage,
  isPlaceholder,
  isPort,
  record,
  yamlQuote,
} from "./livekit_selfhost_utils.mjs";

export const EGRESS_DEFAULTS = {
  LIVEKIT_EGRESS_ENABLED: "false",
  LIVEKIT_EGRESS_IMAGE: "",
  LIVEKIT_EGRESS_HEALTH_PORT: "7981",
  LIVEKIT_EGRESS_PROMETHEUS_PORT: "6790",
  LIVEKIT_EGRESS_FILE_MAX_DURATION: "2h",
  LIVEKIT_EGRESS_S3_BUCKET: "",
  LIVEKIT_EGRESS_S3_REGION: "",
  LIVEKIT_EGRESS_S3_ENDPOINT: "",
  LIVEKIT_EGRESS_S3_ACCESS_KEY: "",
  LIVEKIT_EGRESS_S3_SECRET_KEY: "",
  LIVEKIT_EGRESS_S3_SSE: "AES256",
  LIVEKIT_EGRESS_S3_KMS_KEY_ID: "",
  LIVEKIT_EGRESS_OBJECT_PREFIX: "recordings",
  LIVEKIT_EGRESS_MAX_RETENTION_DAYS: "30",
  LIVEKIT_EGRESS_ARTIFACT_BATCH_SIZE: "4",
  LIVEKIT_EGRESS_ARTIFACT_RECOVERY_INTERVAL_SECONDS: "60",
};

export function validateLiveKitEgressEnv(env, checks, issues) {
  const flagOk = ["true", "false"].includes(env.LIVEKIT_EGRESS_ENABLED);
  record(checks, "LIVEKIT_EGRESS_ENABLED", flagOk, {
    enabled: env.LIVEKIT_EGRESS_ENABLED === "true",
  });
  if (!flagOk) {
    issues.push("LiveKit self-host invalid LIVEKIT_EGRESS_ENABLED");
    return;
  }
  if (env.LIVEKIT_EGRESS_ENABLED !== "true") return;

  const imageOk = isImmutableImage(env.LIVEKIT_EGRESS_IMAGE);
  record(checks, "LIVEKIT_EGRESS_IMAGE", imageOk, { digestPinned: imageOk });
  if (!imageOk) {
    issues.push("LiveKit self-host LIVEKIT_EGRESS_IMAGE must use tag and sha256 digest");
  }
  for (const name of ["LIVEKIT_EGRESS_HEALTH_PORT", "LIVEKIT_EGRESS_PROMETHEUS_PORT"]) {
    const ok = isPort(env[name]);
    record(checks, name, ok, { value: env[name] });
    if (!ok) issues.push(`LiveKit self-host invalid ${name}`);
  }
  const distinctPorts = new Set([
    env.LIVEKIT_HTTP_PORT,
    env.LIVEKIT_SIP_HEALTH_PORT,
    env.LIVEKIT_SIP_PROMETHEUS_PORT,
    env.LIVEKIT_EGRESS_HEALTH_PORT,
    env.LIVEKIT_EGRESS_PROMETHEUS_PORT,
  ]).size === 5;
  record(checks, "LIVEKIT_EGRESS_PORTS_DISTINCT", distinctPorts);
  if (!distinctPorts) issues.push("LiveKit self-host Egress ports must be distinct");

  for (const name of [
    "LIVEKIT_EGRESS_S3_BUCKET",
    "LIVEKIT_EGRESS_S3_REGION",
    "LIVEKIT_EGRESS_S3_ACCESS_KEY",
    "LIVEKIT_EGRESS_S3_SECRET_KEY",
  ]) {
    const ok = hasRealValue(env[name]);
    record(checks, name, ok, { configured: ok });
    if (!ok) issues.push(`LiveKit self-host env missing ${name}`);
  }
  const endpointOk = !env.LIVEKIT_EGRESS_S3_ENDPOINT ||
    validStorageEndpoint(env.LIVEKIT_EGRESS_S3_ENDPOINT);
  record(checks, "LIVEKIT_EGRESS_S3_ENDPOINT", endpointOk, {
    configured: Boolean(env.LIVEKIT_EGRESS_S3_ENDPOINT),
  });
  if (!endpointOk) issues.push("LiveKit self-host invalid LIVEKIT_EGRESS_S3_ENDPOINT");
  const sseOk = ["AES256", "aws:kms"].includes(env.LIVEKIT_EGRESS_S3_SSE) &&
    (env.LIVEKIT_EGRESS_S3_SSE !== "aws:kms" ||
      hasRealValue(env.LIVEKIT_EGRESS_S3_KMS_KEY_ID));
  record(checks, "LIVEKIT_EGRESS_S3_SSE", sseOk, {
    mode: env.LIVEKIT_EGRESS_S3_SSE,
  });
  if (!sseOk) issues.push("LiveKit self-host invalid Egress storage encryption");

  const durationOk = /^[1-9]\d*[smh]$/.test(env.LIVEKIT_EGRESS_FILE_MAX_DURATION);
  record(checks, "LIVEKIT_EGRESS_FILE_MAX_DURATION", durationOk, {
    value: env.LIVEKIT_EGRESS_FILE_MAX_DURATION,
  });
  if (!durationOk) issues.push("LiveKit self-host invalid Egress file duration limit");
  const prefixOk = /^[A-Za-z0-9][A-Za-z0-9/_-]{0,63}$/.test(
    env.LIVEKIT_EGRESS_OBJECT_PREFIX,
  );
  record(checks, "LIVEKIT_EGRESS_OBJECT_PREFIX", prefixOk);
  if (!prefixOk) issues.push("LiveKit self-host invalid Egress object prefix");
  const retention = Number(env.LIVEKIT_EGRESS_MAX_RETENTION_DAYS);
  const retentionOk = Number.isInteger(retention) && retention >= 1 && retention <= 365;
  record(checks, "LIVEKIT_EGRESS_MAX_RETENTION_DAYS", retentionOk, { retention });
  if (!retentionOk) issues.push("LiveKit self-host invalid Egress retention days");
  for (const [name, min, max] of [
    ["LIVEKIT_EGRESS_ARTIFACT_BATCH_SIZE", 1, 20],
    ["LIVEKIT_EGRESS_ARTIFACT_RECOVERY_INTERVAL_SECONDS", 10, 3600],
  ]) {
    const value = Number(env[name]);
    const ok = Number.isInteger(value) && value >= min && value <= max;
    record(checks, name, ok, { value });
    if (!ok) issues.push(`LiveKit self-host invalid ${name}`);
  }
}

export function toLiveKitEgressConfig(env) {
  return {
    egressEnabled: env.LIVEKIT_EGRESS_ENABLED === "true",
    egressImage: env.LIVEKIT_EGRESS_IMAGE,
    egressHealthPort: Number(env.LIVEKIT_EGRESS_HEALTH_PORT),
    egressPrometheusPort: Number(env.LIVEKIT_EGRESS_PROMETHEUS_PORT),
    egressFileMaxDuration: env.LIVEKIT_EGRESS_FILE_MAX_DURATION,
    egressBucket: env.LIVEKIT_EGRESS_S3_BUCKET,
    egressRegion: env.LIVEKIT_EGRESS_S3_REGION,
    egressEndpoint: env.LIVEKIT_EGRESS_S3_ENDPOINT,
    egressAccessKey: env.LIVEKIT_EGRESS_S3_ACCESS_KEY,
    egressSecretKey: env.LIVEKIT_EGRESS_S3_SECRET_KEY,
    egressSse: env.LIVEKIT_EGRESS_S3_SSE,
    egressKmsKeyId: env.LIVEKIT_EGRESS_S3_KMS_KEY_ID,
    egressObjectPrefix: env.LIVEKIT_EGRESS_OBJECT_PREFIX,
    egressMaxRetentionDays: Number(env.LIVEKIT_EGRESS_MAX_RETENTION_DAYS),
    egressArtifactBatchSize: Number(env.LIVEKIT_EGRESS_ARTIFACT_BATCH_SIZE),
    egressArtifactRecoveryIntervalSeconds: Number(
      env.LIVEKIT_EGRESS_ARTIFACT_RECOVERY_INTERVAL_SECONDS,
    ),
  };
}

export function renderLiveKitEgressYaml(config) {
  return [
    `api_key: ${yamlQuote(config.apiKey)}`,
    `api_secret: ${yamlQuote(config.apiSecret)}`,
    `ws_url: ws://127.0.0.1:${config.httpPort}`,
    "redis:",
    "  address: 127.0.0.1:6379",
    `health_port: ${config.egressHealthPort}`,
    `prometheus_port: ${config.egressPrometheusPort}`,
    "logging:",
    "  level: info",
    "  json: true",
    "session_limits:",
    `  file_output_max_duration: ${config.egressFileMaxDuration}`,
    "storage:",
    "  s3:",
    `    access_key: ${yamlQuote(config.egressAccessKey)}`,
    `    secret: ${yamlQuote(config.egressSecretKey)}`,
    `    region: ${yamlQuote(config.egressRegion)}`,
    ...(config.egressEndpoint
      ? [`    endpoint: ${yamlQuote(config.egressEndpoint)}`]
      : []),
    `    bucket: ${yamlQuote(config.egressBucket)}`,
    "    max_retries: 5",
    "    max_retry_delay: 5s",
    "    min_retry_delay: 500ms",
    "",
  ].join("\n");
}

export function renderLiveKitEgressCompose(config) {
  if (!config.egressEnabled) return "";
  return `
  egress:
    image: ${config.egressImage}
    network_mode: host
    restart: unless-stopped
    environment:
      EGRESS_CONFIG_FILE: /etc/egress.yaml
      LIVEKIT_PREFER_SOFTWARE: "true"
    depends_on:
      - livekit
      - redis
    volumes:
      - ./egress.yaml:/etc/egress.yaml:ro
    shm_size: 1gb
    healthcheck:
      test: ["CMD", "/bin/bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/${config.egressHealthPort}"]
      interval: 10s
      timeout: 3s
      retries: 12
`;
}

export function renderLiveKitEgressReleaseEnv(config) {
  return `LIVEKIT_EGRESS_ENABLED=${config.egressEnabled}
LIVEKIT_EGRESS_S3_BUCKET=${config.egressBucket ?? ""}
LIVEKIT_EGRESS_S3_REGION=${config.egressRegion ?? ""}
LIVEKIT_EGRESS_S3_ENDPOINT=${config.egressEndpoint ?? ""}
LIVEKIT_EGRESS_S3_ACCESS_KEY=${config.egressAccessKey ?? ""}
LIVEKIT_EGRESS_S3_SECRET_KEY=${config.egressSecretKey ?? ""}
LIVEKIT_EGRESS_S3_SSE=${config.egressSse ?? "AES256"}
LIVEKIT_EGRESS_S3_KMS_KEY_ID=${config.egressKmsKeyId ?? ""}
LIVEKIT_EGRESS_OBJECT_PREFIX=${config.egressObjectPrefix ?? "recordings"}
LIVEKIT_EGRESS_MAX_RETENTION_DAYS=${config.egressMaxRetentionDays || 30}
LIVEKIT_EGRESS_ARTIFACT_BATCH_SIZE=${config.egressArtifactBatchSize || 4}
LIVEKIT_EGRESS_ARTIFACT_RECOVERY_INTERVAL_SECONDS=${
    config.egressArtifactRecoveryIntervalSeconds || 60
  }
`;
}

function validStorageEndpoint(value) {
  if (isPlaceholder(value)) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
