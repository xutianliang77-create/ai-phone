import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  EnterpriseDatabaseManifest,
} from "./enterprise-postgres-database-manifest.js";
import type {
  EnterpriseDatabaseComparison,
} from "./enterprise-postgres-database-comparison.js";
import { stableEnterpriseCutoverJson } from "./enterprise-postgres-database-manifest.js";

export type EnterpriseCutoverPhase = "baseline" | "cutover" | "restore";
export type EnterpriseCutoverEnvironment = "local" | "staging";

export interface EnterpriseWriterFenceEvidence {
  sourceDefaultReadOnly: boolean;
  sourceWriteProbeRejected: boolean;
  sourceActiveWriterSessions: number;
  targetDefaultReadOnly: boolean;
  targetWriteProbeSucceeded: boolean;
  targetActiveWriterSessions: number;
  writerRoles: string[];
}

export interface EnterpriseCutoverEvidence {
  formatVersion: 1;
  kind: "enterprise_primary_cutover";
  phase: EnterpriseCutoverPhase;
  status: "matched" | "mismatch";
  environment: EnterpriseCutoverEnvironment;
  runId: string;
  cutoverId: string;
  gitCommit: string;
  imageDigest: string;
  topologySha256: string;
  source: EnterpriseDatabaseManifest;
  target: EnterpriseDatabaseManifest;
  comparison: EnterpriseDatabaseComparison;
  baseline?: {
    fileSha256: string;
    sourceSha256: string;
    sourceWalLsn: string;
  };
  writerFence?: EnterpriseWriterFenceEvidence;
  restoreIsolation?: {
    restoreDefaultReadOnly: boolean;
    restoreWriteProbeRejected: boolean;
    restoreActiveWriterSessions: number;
  };
  capturedAt: string;
  signature: string;
}

export interface EnterpriseCutoverMetadata {
  environment: EnterpriseCutoverEnvironment;
  runId: string;
  cutoverId: string;
  gitCommit: string;
  imageDigest: string;
  topologySha256: string;
}

export function enterpriseCutoverMetadata(
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseCutoverMetadata {
  const configuredEnvironment = env.ENTERPRISE_CUTOVER_ENVIRONMENT?.trim();
  if (configuredEnvironment !== "local" && configuredEnvironment !== "staging") {
    throw new Error("ENTERPRISE_CUTOVER_ENVIRONMENT must be local or staging");
  }
  const environment: EnterpriseCutoverEnvironment = configuredEnvironment;
  const metadata = {
    environment,
    runId: required(env.ENTERPRISE_CUTOVER_RUN_ID, "ENTERPRISE_CUTOVER_RUN_ID"),
    cutoverId: required(env.POSTGRES_CUTOVER_ID, "POSTGRES_CUTOVER_ID"),
    gitCommit: required(env.ENTERPRISE_CUTOVER_GIT_COMMIT, "ENTERPRISE_CUTOVER_GIT_COMMIT"),
    imageDigest: required(
      env.ENTERPRISE_CUTOVER_IMAGE_DIGEST,
      "ENTERPRISE_CUTOVER_IMAGE_DIGEST",
    ),
    topologySha256: required(
      env.ENTERPRISE_CUTOVER_TOPOLOGY_SHA256,
      "ENTERPRISE_CUTOVER_TOPOLOGY_SHA256",
    ),
  };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(metadata.runId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(metadata.cutoverId)) {
    throw new Error("Enterprise cutover run and cutover IDs are invalid");
  }
  if (!/^[0-9a-f]{7,40}$/i.test(metadata.gitCommit)) {
    throw new Error("ENTERPRISE_CUTOVER_GIT_COMMIT must be a Git commit");
  }
  if (!/^sha256:[0-9a-f]{64}$/i.test(metadata.imageDigest)) {
    throw new Error("ENTERPRISE_CUTOVER_IMAGE_DIGEST must be a sha256 digest");
  }
  if (!/^[0-9a-f]{64}$/i.test(metadata.topologySha256)) {
    throw new Error("ENTERPRISE_CUTOVER_TOPOLOGY_SHA256 must be a SHA-256 hash");
  }
  return metadata;
}

export function enterpriseCutoverSigningKey(env: NodeJS.ProcessEnv = process.env) {
  const key = env.ENTERPRISE_CUTOVER_EVIDENCE_HMAC_KEY;
  if ((key?.length ?? 0) < 32) {
    throw new Error("ENTERPRISE_CUTOVER_EVIDENCE_HMAC_KEY must be at least 32 characters");
  }
  return key!;
}

export function writeEnterpriseCutoverEvidence(
  fileName: string,
  input: Omit<EnterpriseCutoverEvidence, "signature">,
  signingKey: string,
) {
  assertSigningKey(signingKey);
  const signature = sign(input, signingKey);
  const evidence: EnterpriseCutoverEvidence = { ...input, signature };
  const file = resolve(required(fileName, "enterprise cutover evidence file"));
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  renameSync(temporary, file);
  return evidence;
}

export function readEnterpriseCutoverEvidence(fileName: string, signingKey: string) {
  return readEnterpriseCutoverEvidenceWithHash(fileName, signingKey).evidence;
}

export function readEnterpriseCutoverEvidenceWithHash(
  fileName: string,
  signingKey: string,
) {
  assertSigningKey(signingKey);
  const file = resolve(required(fileName, "enterprise cutover evidence file"));
  let parsed: unknown;
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("Enterprise cutover evidence cannot be read");
  }
  assertEvidenceShape(parsed);
  const { signature, ...unsigned } = parsed;
  const expected = sign(unsigned, signingKey);
  if (!safeEqual(signature, expected)) {
    throw new Error("Enterprise cutover evidence signature is invalid");
  }
  return {
    evidence: parsed,
    fileSha256: createHash("sha256").update(contents).digest("hex"),
  };
}

function assertEvidenceShape(value: unknown): asserts value is EnterpriseCutoverEvidence {
  if (!isObject(value) || value.formatVersion !== 1 ||
    value.kind !== "enterprise_primary_cutover" ||
    !["baseline", "cutover", "restore"].includes(String(value.phase)) ||
    !["matched", "mismatch"].includes(String(value.status)) ||
    !["local", "staging"].includes(String(value.environment)) ||
    typeof value.runId !== "string" || typeof value.cutoverId !== "string" ||
    typeof value.gitCommit !== "string" || typeof value.imageDigest !== "string" ||
    typeof value.topologySha256 !== "string" || !isObject(value.source) ||
    !isObject(value.target) || !isObject(value.comparison) ||
    typeof value.capturedAt !== "string" || typeof value.signature !== "string") {
    throw new Error("Enterprise cutover evidence is invalid");
  }
}

function sign(value: object, signingKey: string) {
  return createHmac("sha256", signingKey)
    .update(stableEnterpriseCutoverJson(value)).digest("hex");
}

function safeEqual(left: string, right: string) {
  return left.length === right.length &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function assertSigningKey(key: string) {
  if (key.length < 32) throw new Error("Enterprise cutover signing key is too short");
}

function required(value: string | undefined, name: string) {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
