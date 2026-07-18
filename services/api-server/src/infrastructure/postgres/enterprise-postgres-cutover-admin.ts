import { pathToFileURL } from "node:url";
import type { EnterpriseCutoverQueryClient } from "./enterprise-postgres-database-manifest.js";
import {
  collectEnterpriseDatabaseManifest,
} from "./enterprise-postgres-database-manifest.js";
import {
  compareEnterpriseDatabaseManifests,
} from "./enterprise-postgres-database-comparison.js";
import {
  createEnterprisePostgresClient,
  enterprisePostgresSslConfig,
  type EnterprisePostgresClient,
} from "./enterprise-postgres-client.js";
import {
  enterpriseCutoverMetadata,
  enterpriseCutoverSigningKey,
  readEnterpriseCutoverEvidenceWithHash,
  writeEnterpriseCutoverEvidence,
  type EnterpriseWriterFenceEvidence,
} from "./enterprise-postgres-cutover-evidence.js";

type Command = "baseline" | "cutover" | "restore-verify";

async function main() {
  const command = process.argv[2] as Command | undefined;
  if (!command || !["baseline", "cutover", "restore-verify"].includes(command)) {
    throw new Error("Usage: enterprise:postgres-cutover baseline|cutover|restore-verify");
  }
  const env = process.env;
  const metadata = enterpriseCutoverMetadata(env);
  const signingKey = enterpriseCutoverSigningKey(env);
  const evidenceFile = required(
    env.ENTERPRISE_CUTOVER_EVIDENCE_FILE,
    "ENTERPRISE_CUTOVER_EVIDENCE_FILE",
  );
  const source = database("SOURCE", env);
  const target = database(command === "restore-verify" ? "RESTORE" : "TARGET", env);
  if (source.logicalId === target.logicalId) {
    throw new Error("Enterprise cutover logical database IDs must be distinct");
  }
  const sourceClient = client(source.url, env);
  const targetClient = client(target.url, env);
  await sourceClient.connect();
  try {
    await targetClient.connect();
    try {
      if (command === "baseline") {
        await captureBaseline(sourceClient, targetClient, source.logicalId,
          target.logicalId, evidenceFile, signingKey, metadata);
      } else if (command === "cutover") {
        await captureCutover(sourceClient, targetClient, source.logicalId,
          target.logicalId, evidenceFile, signingKey, metadata, env);
      } else {
        await captureRestore(sourceClient, targetClient, source.logicalId,
          target.logicalId, evidenceFile, signingKey, metadata, env);
      }
    } finally {
      await targetClient.end();
    }
  } finally {
    await sourceClient.end();
  }
}

async function captureBaseline(
  sourceClient: EnterprisePostgresClient,
  targetClient: EnterprisePostgresClient,
  sourceId: string,
  targetId: string,
  evidenceFile: string,
  signingKey: string,
  metadata: ReturnType<typeof enterpriseCutoverMetadata>,
) {
  const source = await collectEnterpriseDatabaseManifest(sourceClient, sourceId);
  const target = await collectEnterpriseDatabaseManifest(targetClient, targetId);
  assertDifferentDatabases(source.database, target.database);
  const comparison = compareEnterpriseDatabaseManifests(source, target);
  const evidence = writeEnterpriseCutoverEvidence(evidenceFile, {
    formatVersion: 1,
    kind: "enterprise_primary_cutover",
    phase: "baseline",
    status: comparison.status,
    ...metadata,
    source,
    target,
    comparison,
    capturedAt: new Date().toISOString(),
  }, signingKey);
  printSummary(evidence);
  if (comparison.status !== "matched") throw new Error("Enterprise baseline mismatch");
}

async function captureCutover(
  sourceClient: EnterprisePostgresClient,
  targetClient: EnterprisePostgresClient,
  sourceId: string,
  targetId: string,
  evidenceFile: string,
  signingKey: string,
  metadata: ReturnType<typeof enterpriseCutoverMetadata>,
  env: NodeJS.ProcessEnv,
) {
  const baselineFile = required(
    env.ENTERPRISE_CUTOVER_BASELINE_FILE,
    "ENTERPRISE_CUTOVER_BASELINE_FILE",
  );
  const baselineResult = readEnterpriseCutoverEvidenceWithHash(baselineFile, signingKey);
  const baseline = baselineResult.evidence;
  assertBaseline(baseline, metadata, sourceId, targetId);
  const writerRoles = writerRoleNames(env);
  const writerFence: EnterpriseWriterFenceEvidence = {
    sourceDefaultReadOnly: await defaultReadOnly(sourceClient),
    sourceWriteProbeRejected: await writeProbeRejected(sourceClient),
    sourceActiveWriterSessions: await writerSessions(sourceClient, writerRoles),
    targetDefaultReadOnly: await defaultReadOnly(targetClient),
    targetWriteProbeSucceeded: !(await writeProbeRejected(targetClient)),
    targetActiveWriterSessions: await writerSessions(targetClient, writerRoles),
    writerRoles,
  };
  const source = await collectEnterpriseDatabaseManifest(sourceClient, sourceId);
  const target = await collectEnterpriseDatabaseManifest(targetClient, targetId);
  assertBaselineDatabases(baseline, source, target);
  assertDifferentDatabases(source.database, target.database);
  const comparison = compareEnterpriseDatabaseManifests(source, target);
  const fencePassed = writerFence.sourceDefaultReadOnly &&
    writerFence.sourceWriteProbeRejected && !writerFence.targetDefaultReadOnly &&
    writerFence.targetWriteProbeSucceeded &&
    writerFence.sourceActiveWriterSessions === 0 &&
    writerFence.targetActiveWriterSessions === 0;
  const status = comparison.status === "matched" && fencePassed ? "matched" : "mismatch";
  const evidence = writeEnterpriseCutoverEvidence(evidenceFile, {
    formatVersion: 1,
    kind: "enterprise_primary_cutover",
    phase: "cutover",
    status,
    ...metadata,
    source,
    target,
    comparison,
    baseline: {
      fileSha256: baselineResult.fileSha256,
      sourceSha256: baseline.source.sha256,
      sourceWalLsn: baseline.source.walLsn,
    },
    writerFence,
    capturedAt: new Date().toISOString(),
  }, signingKey);
  printSummary(evidence);
  if (status !== "matched") throw new Error("Enterprise cutover verification failed");
}

async function captureRestore(
  targetClient: EnterprisePostgresClient,
  restoreClient: EnterprisePostgresClient,
  targetId: string,
  restoreId: string,
  evidenceFile: string,
  signingKey: string,
  metadata: ReturnType<typeof enterpriseCutoverMetadata>,
  env: NodeJS.ProcessEnv,
) {
  const writerRoles = writerRoleNames(env);
  const isolation = {
    restoreDefaultReadOnly: await defaultReadOnly(restoreClient),
    restoreWriteProbeRejected: await writeProbeRejected(restoreClient),
    restoreActiveWriterSessions: await writerSessions(restoreClient, writerRoles),
  };
  const source = await collectEnterpriseDatabaseManifest(targetClient, targetId);
  const target = await collectEnterpriseDatabaseManifest(restoreClient, restoreId);
  assertDifferentDatabases(source.database, target.database);
  const comparison = compareEnterpriseDatabaseManifests(source, target);
  const isolated = isolation.restoreDefaultReadOnly && isolation.restoreWriteProbeRejected &&
    isolation.restoreActiveWriterSessions === 0;
  const status = comparison.status === "matched" && isolated ? "matched" : "mismatch";
  const evidence = writeEnterpriseCutoverEvidence(evidenceFile, {
    formatVersion: 1,
    kind: "enterprise_primary_cutover",
    phase: "restore",
    status,
    ...metadata,
    source,
    target,
    comparison,
    restoreIsolation: isolation,
    capturedAt: new Date().toISOString(),
  }, signingKey);
  printSummary(evidence);
  if (status !== "matched") throw new Error("Enterprise restore verification failed");
}

function client(url: string, env: NodeJS.ProcessEnv) {
  return createEnterprisePostgresClient({
    connectionString: url,
    ssl: enterprisePostgresSslConfig(env),
  });
}

function database(prefix: "SOURCE" | "TARGET" | "RESTORE", env: NodeJS.ProcessEnv) {
  return {
    url: required(env[`ENTERPRISE_CUTOVER_${prefix}_DATABASE_URL`],
      `ENTERPRISE_CUTOVER_${prefix}_DATABASE_URL`),
    logicalId: required(env[`ENTERPRISE_CUTOVER_${prefix}_ID`],
      `ENTERPRISE_CUTOVER_${prefix}_ID`),
  };
}

function writerRoleNames(env: NodeJS.ProcessEnv) {
  const roles = required(
    env.ENTERPRISE_CUTOVER_OLD_WRITER_ROLES,
    "ENTERPRISE_CUTOVER_OLD_WRITER_ROLES",
  ).split(",").map((role) => role.trim());
  if (roles.some((role) => !/^[a-z_][a-z0-9_]{0,62}$/.test(role)) ||
    new Set(roles).size !== roles.length) {
    throw new Error("ENTERPRISE_CUTOVER_OLD_WRITER_ROLES is invalid");
  }
  return roles;
}

async function defaultReadOnly(client: EnterpriseCutoverQueryClient) {
  const result = await client.query<{ value: string }>(
    "SELECT current_setting('default_transaction_read_only') AS value",
  );
  if (!result.rows[0] || !["on", "off"].includes(result.rows[0].value)) {
    throw new Error("PostgreSQL read-only state is unavailable");
  }
  return result.rows[0].value === "on";
}

async function writeProbeRejected(client: EnterpriseCutoverQueryClient) {
  try {
    await client.query("UPDATE enterprise.tenants SET updated_at = updated_at WHERE false");
    return false;
  } catch (error) {
    if (isErrorCode(error, "25006")) return true;
    throw error;
  }
}

async function writerSessions(client: EnterpriseCutoverQueryClient, roles: string[]) {
  const result = await client.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM pg_stat_activity
    WHERE usename = ANY($1::text[]) AND pid <> pg_backend_pid()
  `, [roles]);
  const count = Number(result.rows[0]?.count);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("PostgreSQL writer session count is invalid");
  }
  return count;
}

function assertBaseline(
  evidence: ReturnType<typeof readEnterpriseCutoverEvidenceWithHash>["evidence"],
  metadata: ReturnType<typeof enterpriseCutoverMetadata>,
  sourceId: string,
  targetId: string,
) {
  if (evidence.phase !== "baseline" || evidence.status !== "matched" ||
    evidence.cutoverId !== metadata.cutoverId ||
    evidence.environment !== metadata.environment ||
    evidence.gitCommit !== metadata.gitCommit ||
    evidence.imageDigest !== metadata.imageDigest ||
    evidence.topologySha256 !== metadata.topologySha256 ||
    evidence.source.logicalId !== sourceId || evidence.target.logicalId !== targetId) {
    throw new Error("Enterprise cutover baseline evidence does not match this run");
  }
}

function assertBaselineDatabases(
  baseline: ReturnType<typeof readEnterpriseCutoverEvidenceWithHash>["evidence"],
  source: { database: { systemIdentifier: string; oid: string }; walLsn: string },
  target: { database: { systemIdentifier: string; oid: string } },
) {
  if (!sameDatabase(baseline.source.database, source.database) ||
    !sameDatabase(baseline.target.database, target.database) ||
    !walLsnAtLeast(source.walLsn, baseline.source.walLsn)) {
    throw new Error("Enterprise cutover databases or source WAL watermark changed");
  }
}

function assertDifferentDatabases(
  left: { systemIdentifier: string; oid: string },
  right: { systemIdentifier: string; oid: string },
) {
  if (left.systemIdentifier === right.systemIdentifier && left.oid === right.oid) {
    throw new Error("Enterprise cutover source and target databases are identical");
  }
}

function sameDatabase(
  left: { systemIdentifier: string; oid: string },
  right: { systemIdentifier: string; oid: string },
) {
  return left.systemIdentifier === right.systemIdentifier && left.oid === right.oid;
}

function walLsnAtLeast(current: string, baseline: string) {
  const parse = (value: string) => {
    const parts = /^([0-9A-F]+)\/([0-9A-F]+)$/i.exec(value);
    if (!parts) throw new Error("Enterprise cutover WAL LSN is invalid");
    return (BigInt(`0x${parts[1]}`) << 32n) + BigInt(`0x${parts[2]}`);
  };
  return parse(current) >= parse(baseline);
}

function isErrorCode(error: unknown, code: string) {
  return error !== null && typeof error === "object" &&
    "code" in error && (error as { code?: unknown }).code === code;
}

function required(value: string | undefined, name: string) {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function printSummary(evidence: { phase: string; status: string; source: {
  totalCount: number; sha256: string; walLsn: string;
}; target: { totalCount: number; sha256: string; walLsn: string } }) {
  console.log(JSON.stringify({
    phase: evidence.phase,
    status: evidence.status,
    source: {
      totalCount: evidence.source.totalCount,
      sha256: evidence.source.sha256,
      walLsn: evidence.source.walLsn,
    },
    target: {
      totalCount: evidence.target.totalCount,
      sha256: evidence.target.sha256,
      walLsn: evidence.target.walLsn,
    },
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
