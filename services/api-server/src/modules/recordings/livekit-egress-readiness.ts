import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";

export interface RecordingArtifactConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  objectPrefix: string;
  maxRetentionDays: number;
  serverSideEncryption: "AES256" | "aws:kms";
  kmsKeyId?: string;
  artifactBatchSize: number;
  artifactRecoveryIntervalSeconds: number;
}

export interface LiveKitEgressConfig extends RecordingArtifactConfig {
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
  requestTimeoutSeconds: number;
}

export function getLiveKitEgressReadiness() {
  const room = getLiveKitRoomConfig();
  const enabled = process.env.LIVEKIT_EGRESS_ENABLED === "true";
  const issues = [
    ...(enabled ? [] : ["egress requires LIVEKIT_EGRESS_ENABLED=true"]),
    ...(process.env.LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED === "true"
      ? []
      : ["egress requires LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED=true"]),
    ...(room.ok ? [] : room.issues),
    ...required("LIVEKIT_EGRESS_S3_BUCKET"),
    ...required("LIVEKIT_EGRESS_S3_REGION"),
    ...required("LIVEKIT_EGRESS_S3_ACCESS_KEY"),
    ...secretIssues(),
    ...endpointIssues(),
    ...prefixIssues(),
    ...encryptionIssues(),
    ...integerIssues("LIVEKIT_EGRESS_REQUEST_TIMEOUT_SECONDS", 2, 30),
    ...integerIssues("LIVEKIT_EGRESS_MAX_RETENTION_DAYS", 1, 365),
    ...integerIssues("LIVEKIT_EGRESS_ARTIFACT_BATCH_SIZE", 1, 20),
    ...integerIssues("LIVEKIT_EGRESS_ARTIFACT_RECOVERY_INTERVAL_SECONDS", 10, 3600),
  ];
  return {
    status: issues.length === 0 ? "ready" as const : "not_ready" as const,
    enabled,
    storage: process.env.LIVEKIT_EGRESS_S3_BUCKET ? "configured" : "required",
    issues,
  };
}

export function getLiveKitEgressConfig():
  | { ok: true; config: LiveKitEgressConfig }
  | { ok: false; issues: string[] } {
  const readiness = getLiveKitEgressReadiness();
  const room = getLiveKitRoomConfig();
  if (readiness.status !== "ready" || !room.ok) {
    return { ok: false, issues: readiness.issues };
  }
  return {
    ok: true,
    config: {
      ...recordingArtifactConfig(),
      livekitUrl: room.config.livekitUrl,
      apiKey: room.config.apiKey,
      apiSecret: room.config.apiSecret,
      requestTimeoutSeconds: integer("LIVEKIT_EGRESS_REQUEST_TIMEOUT_SECONDS", 10),
    },
  };
}

export function getRecordingArtifactConfig():
  | { ok: true; config: RecordingArtifactConfig }
  | { ok: false; issues: string[] } {
  if (process.env.LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED !== "true") {
    return { ok: false, issues: ["recording artifact worker is disabled"] };
  }
  const issues = [
    ...required("LIVEKIT_EGRESS_S3_BUCKET"),
    ...required("LIVEKIT_EGRESS_S3_REGION"),
    ...required("LIVEKIT_EGRESS_S3_ACCESS_KEY"),
    ...secretIssues(),
    ...endpointIssues(),
    ...prefixIssues(),
    ...encryptionIssues(),
    ...integerIssues("LIVEKIT_EGRESS_MAX_RETENTION_DAYS", 1, 365),
    ...integerIssues("LIVEKIT_EGRESS_ARTIFACT_BATCH_SIZE", 1, 20),
    ...integerIssues("LIVEKIT_EGRESS_ARTIFACT_RECOVERY_INTERVAL_SECONDS", 10, 3600),
  ];
  return issues.length === 0
    ? { ok: true, config: recordingArtifactConfig() }
    : { ok: false, issues };
}

function recordingArtifactConfig(): RecordingArtifactConfig {
  return {
    bucket: process.env.LIVEKIT_EGRESS_S3_BUCKET!,
    region: process.env.LIVEKIT_EGRESS_S3_REGION!,
    ...(process.env.LIVEKIT_EGRESS_S3_ENDPOINT?.trim()
      ? { endpoint: process.env.LIVEKIT_EGRESS_S3_ENDPOINT.trim() }
      : {}),
    accessKey: process.env.LIVEKIT_EGRESS_S3_ACCESS_KEY!,
    secretKey: process.env.LIVEKIT_EGRESS_S3_SECRET_KEY!,
    forcePathStyle: process.env.LIVEKIT_EGRESS_S3_FORCE_PATH_STYLE === "true",
    objectPrefix: normalizedPrefix(),
    maxRetentionDays: integer("LIVEKIT_EGRESS_MAX_RETENTION_DAYS", 30),
    serverSideEncryption: encryptionMode(),
    ...(encryptionMode() === "aws:kms"
      ? { kmsKeyId: process.env.LIVEKIT_EGRESS_S3_KMS_KEY_ID!.trim() }
      : {}),
    artifactBatchSize: integer("LIVEKIT_EGRESS_ARTIFACT_BATCH_SIZE", 4),
    artifactRecoveryIntervalSeconds: integer(
      "LIVEKIT_EGRESS_ARTIFACT_RECOVERY_INTERVAL_SECONDS",
      60,
    ),
  };
}

function required(name: string) {
  return process.env[name]?.trim() ? [] : [`egress missing ${name}`];
}

function secretIssues() {
  return (process.env.LIVEKIT_EGRESS_S3_SECRET_KEY ?? "").length >= 16
    ? []
    : ["egress LIVEKIT_EGRESS_S3_SECRET_KEY must be at least 16 characters"];
}

function endpointIssues() {
  const value = process.env.LIVEKIT_EGRESS_S3_ENDPOINT?.trim();
  if (!value) return [];
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      ? []
      : ["egress LIVEKIT_EGRESS_S3_ENDPOINT must use http or https"];
  } catch {
    return ["egress LIVEKIT_EGRESS_S3_ENDPOINT is invalid"];
  }
}

function prefixIssues() {
  const prefix = normalizedPrefix();
  return prefix && !prefix.includes("..") && /^[A-Za-z0-9/_-]+$/.test(prefix)
    ? []
    : ["egress LIVEKIT_EGRESS_OBJECT_PREFIX is invalid"];
}

function encryptionIssues() {
  const mode = process.env.LIVEKIT_EGRESS_S3_SSE ?? "AES256";
  if (mode !== "AES256" && mode !== "aws:kms") {
    return ["egress LIVEKIT_EGRESS_S3_SSE must be AES256 or aws:kms"];
  }
  if (mode === "aws:kms" && !process.env.LIVEKIT_EGRESS_S3_KMS_KEY_ID?.trim()) {
    return ["egress LIVEKIT_EGRESS_S3_KMS_KEY_ID is required for aws:kms"];
  }
  return [];
}

function encryptionMode() {
  return process.env.LIVEKIT_EGRESS_S3_SSE === "aws:kms"
    ? "aws:kms" as const
    : "AES256" as const;
}

function normalizedPrefix() {
  return (process.env.LIVEKIT_EGRESS_OBJECT_PREFIX ?? "recordings")
    .replace(/^\/+|\/+$/g, "");
}

function integerIssues(name: string, minimum: number, maximum: number) {
  const value = process.env[name];
  if (!value) return [];
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? []
    : [`egress ${name} must be ${minimum}-${maximum}`];
}

function integer(name: string, fallback: number) {
  return process.env[name] ? Number(process.env[name]) : fallback;
}
