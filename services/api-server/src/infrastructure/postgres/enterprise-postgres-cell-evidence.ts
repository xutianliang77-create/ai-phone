import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { EnterpriseCellDataManifest } from
  "./enterprise-postgres-cell-manifest.js";
import type { EnterpriseCellWriterFence } from
  "./enterprise-postgres-cell-fence.js";
import { stableEnterpriseCutoverJson as stableJson } from
  "./enterprise-postgres-database-manifest.js";

export type EnterpriseCellMigrationPhase = "export" | "cutover" | "rollback";

export interface EnterpriseCellMigrationMetadata {
  environment: "local" | "staging";
  runId: string;
  migrationId: string;
  tenantId: string;
  sourceCellId: string;
  targetCellId: string;
  sourceLogicalId: string;
  targetLogicalId: string;
  gitCommit: string;
  imageDigest: string;
  topologySha256: string;
}

export interface EnterpriseCellObjectReceipt {
  formatVersion: 1;
  kind: "enterprise_cell_object_transfer";
  status: "matched";
  migrationId: string;
  tenantId: string;
  sourceCellId: string;
  targetCellId: string;
  count: number;
  sha256: string;
  receiptRef: string;
  capturedAt: string;
  signature: string;
}

export interface EnterpriseCellMigrationEvidence {
  formatVersion: 1;
  kind: "enterprise_cell_migration";
  phase: EnterpriseCellMigrationPhase;
  status: "matched" | "mismatch";
  metadata: EnterpriseCellMigrationMetadata;
  source: EnterpriseCellDataManifest;
  target?: EnterpriseCellDataManifest;
  comparison?: {
    status: "matched" | "mismatch";
    mismatchedTables: string[];
    sourceSha256: string;
    targetSha256: string;
  };
  writerFence?: EnterpriseCellWriterFence;
  previousEvidence?: { fileSha256: string; phase: EnterpriseCellMigrationPhase };
  objectReceipt?: Omit<EnterpriseCellObjectReceipt, "signature">;
  capturedAt: string;
  signature: string;
}

export function enterpriseCellMigrationMetadata(
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseCellMigrationMetadata {
  const environment = required(env.ENTERPRISE_CELL_MIGRATION_ENVIRONMENT,
    "ENTERPRISE_CELL_MIGRATION_ENVIRONMENT");
  if (environment !== "local" && environment !== "staging") {
    throw new Error("ENTERPRISE_CELL_MIGRATION_ENVIRONMENT must be local or staging");
  }
  const metadata: EnterpriseCellMigrationMetadata = {
    environment,
    runId: required(env.ENTERPRISE_CELL_MIGRATION_RUN_ID,
      "ENTERPRISE_CELL_MIGRATION_RUN_ID"),
    migrationId: required(env.ENTERPRISE_CELL_MIGRATION_ID,
      "ENTERPRISE_CELL_MIGRATION_ID"),
    tenantId: required(env.ENTERPRISE_CELL_MIGRATION_TENANT_ID,
      "ENTERPRISE_CELL_MIGRATION_TENANT_ID"),
    sourceCellId: required(env.ENTERPRISE_CELL_MIGRATION_SOURCE_CELL_ID,
      "ENTERPRISE_CELL_MIGRATION_SOURCE_CELL_ID"),
    targetCellId: required(env.ENTERPRISE_CELL_MIGRATION_TARGET_CELL_ID,
      "ENTERPRISE_CELL_MIGRATION_TARGET_CELL_ID"),
    sourceLogicalId: required(env.ENTERPRISE_CELL_MIGRATION_SOURCE_ID,
      "ENTERPRISE_CELL_MIGRATION_SOURCE_ID"),
    targetLogicalId: required(env.ENTERPRISE_CELL_MIGRATION_TARGET_ID,
      "ENTERPRISE_CELL_MIGRATION_TARGET_ID"),
    gitCommit: required(env.ENTERPRISE_CELL_MIGRATION_GIT_COMMIT,
      "ENTERPRISE_CELL_MIGRATION_GIT_COMMIT"),
    imageDigest: required(env.ENTERPRISE_CELL_MIGRATION_IMAGE_DIGEST,
      "ENTERPRISE_CELL_MIGRATION_IMAGE_DIGEST"),
    topologySha256: required(env.ENTERPRISE_CELL_MIGRATION_TOPOLOGY_SHA256,
      "ENTERPRISE_CELL_MIGRATION_TOPOLOGY_SHA256"),
  };
  const boundedId = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;
  if (!boundedId.test(metadata.runId) || !boundedId.test(metadata.migrationId) ||
    !boundedId.test(metadata.sourceCellId) || !boundedId.test(metadata.targetCellId) ||
    !boundedId.test(metadata.sourceLogicalId) || !boundedId.test(metadata.targetLogicalId) ||
    metadata.sourceCellId === metadata.targetCellId) {
    throw new Error("Enterprise cell migration identifiers are invalid");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(metadata.tenantId)) {
    throw new Error("Enterprise cell migration tenant ID is invalid");
  }
  if (!/^[0-9a-f]{7,40}$/i.test(metadata.gitCommit) ||
    !/^sha256:[0-9a-f]{64}$/i.test(metadata.imageDigest) ||
    !/^[0-9a-f]{64}$/i.test(metadata.topologySha256)) {
    throw new Error("Enterprise cell migration build identity is invalid");
  }
  return metadata;
}

export function enterpriseCellMigrationSigningKey(env: NodeJS.ProcessEnv = process.env) {
  const key = env.ENTERPRISE_CELL_MIGRATION_EVIDENCE_HMAC_KEY;
  if ((key?.length ?? 0) < 32) {
    throw new Error(
      "ENTERPRISE_CELL_MIGRATION_EVIDENCE_HMAC_KEY must be at least 32 characters",
    );
  }
  return key!;
}

export function enterpriseCellObjectReceiptSigningKey(
  env: NodeJS.ProcessEnv = process.env,
) {
  const key = env.ENTERPRISE_CELL_OBJECT_RECEIPT_HMAC_KEY;
  if ((key?.length ?? 0) < 32) {
    throw new Error(
      "ENTERPRISE_CELL_OBJECT_RECEIPT_HMAC_KEY must be at least 32 characters",
    );
  }
  return key!;
}

export function writeEnterpriseCellMigrationEvidence(
  fileName: string,
  input: Omit<EnterpriseCellMigrationEvidence, "signature">,
  signingKey: string,
) {
  const evidence = { ...input, signature: sign(input, signingKey) };
  atomicWrite(fileName, evidence);
  return evidence;
}

export function readEnterpriseCellMigrationEvidence(
  fileName: string,
  signingKey: string,
) {
  const { value, fileSha256 } = readSignedFile(fileName, signingKey);
  assertMigrationEvidence(value);
  return { evidence: value, fileSha256 };
}

export function writeEnterpriseCellObjectReceipt(
  fileName: string,
  input: Omit<EnterpriseCellObjectReceipt, "signature">,
  signingKey: string,
) {
  const receipt = { ...input, signature: sign(input, signingKey) };
  atomicWrite(fileName, receipt);
  return receipt;
}

export function readEnterpriseCellObjectReceipt(
  fileName: string,
  signingKey: string,
) {
  const { value } = readSignedFile(fileName, signingKey);
  if (!isObject(value) || value.formatVersion !== 1 ||
    value.kind !== "enterprise_cell_object_transfer" || value.status !== "matched" ||
    typeof value.migrationId !== "string" || typeof value.tenantId !== "string" ||
    typeof value.sourceCellId !== "string" || typeof value.targetCellId !== "string" ||
    !Number.isSafeInteger(value.count) || Number(value.count) < 0 ||
    typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(value.sha256) ||
    typeof value.receiptRef !== "string" || value.receiptRef.length < 1 ||
    typeof value.capturedAt !== "string" || typeof value.signature !== "string") {
    throw new Error("Enterprise cell object receipt is invalid");
  }
  return value as unknown as EnterpriseCellObjectReceipt;
}

export function assertEnterpriseCellObjectReceipt(
  receipt: EnterpriseCellObjectReceipt | undefined,
  metadata: EnterpriseCellMigrationMetadata,
  manifest: EnterpriseCellDataManifest,
) {
  if (manifest.objectReferences.count === 0) return;
  if (!receipt || receipt.migrationId !== metadata.migrationId ||
    receipt.tenantId !== metadata.tenantId ||
    receipt.sourceCellId !== metadata.sourceCellId ||
    receipt.targetCellId !== metadata.targetCellId ||
    receipt.count !== manifest.objectReferences.count ||
    receipt.sha256 !== manifest.objectReferences.sha256) {
    throw new Error("Enterprise cell object transfer receipt does not match the manifest");
  }
}

function readSignedFile(fileName: string, signingKey: string) {
  assertKey(signingKey);
  let contents: string;
  let value: unknown;
  try {
    contents = readFileSync(resolve(fileName), "utf8");
    value = JSON.parse(contents);
  } catch {
    throw new Error("Enterprise cell evidence cannot be read");
  }
  if (!isObject(value) || typeof value.signature !== "string") {
    throw new Error("Enterprise cell evidence is invalid");
  }
  const { signature, ...unsigned } = value;
  if (!safeEqual(signature, sign(unsigned, signingKey))) {
    throw new Error("Enterprise cell evidence signature is invalid");
  }
  return { value, fileSha256: createHash("sha256").update(contents).digest("hex") };
}

function assertMigrationEvidence(
  value: unknown,
): asserts value is EnterpriseCellMigrationEvidence {
  if (!isObject(value) || value.formatVersion !== 1 ||
    value.kind !== "enterprise_cell_migration" ||
    !["export", "cutover", "rollback"].includes(String(value.phase)) ||
    !["matched", "mismatch"].includes(String(value.status)) ||
    !isObject(value.metadata) || !isObject(value.source) ||
    typeof value.capturedAt !== "string" || typeof value.signature !== "string") {
    throw new Error("Enterprise cell migration evidence is invalid");
  }
}

function atomicWrite(fileName: string, value: object) {
  const file = resolve(required(fileName, "enterprise cell evidence file"));
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temporary, file);
}
function sign(value: object, key: string) {
  assertKey(key);
  return createHmac("sha256", key).update(stableJson(value)).digest("hex");
}
function safeEqual(left: string, right: string) {
  return left.length === right.length &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right));
}
function assertKey(key: string) {
  if (key.length < 32) throw new Error("Enterprise cell evidence key is too short");
}
function required(value: string | undefined, name: string) {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
