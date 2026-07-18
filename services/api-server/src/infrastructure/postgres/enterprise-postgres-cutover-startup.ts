import type { EnterpriseCutoverQueryClient } from "./enterprise-postgres-database-manifest.js";
import {
  enterpriseCutoverCriticalTables,
} from "./enterprise-postgres-database-manifest.js";
import {
  enterpriseCutoverSigningKey,
  readEnterpriseCutoverEvidence,
} from "./enterprise-postgres-cutover-evidence.js";
import { loadEnterprisePostgresMigrations } from "./enterprise-postgres-migrations.js";
import { expectedPostgresMigrations } from "../storage/postgres-schema-manifest.js";

export async function assertEnterprisePostgresCutoverStartup(
  client: EnterpriseCutoverQueryClient,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.NODE_ENV !== "production") return { status: "not_required" as const };
  const file = required(
    env.ENTERPRISE_CUTOVER_EVIDENCE_FILE,
    "ENTERPRISE_CUTOVER_EVIDENCE_FILE",
  );
  const evidence = readEnterpriseCutoverEvidence(
    file,
    enterpriseCutoverSigningKey(env),
  );
  const expectedEnterprise = loadEnterprisePostgresMigrations().map(({ id, checksum }) => ({
    id,
    checksum,
  }));
  const writerFence = evidence.writerFence;
  const validFence = writerFence?.sourceDefaultReadOnly === true &&
    writerFence.sourceWriteProbeRejected === true &&
    writerFence.sourceActiveWriterSessions === 0 &&
    writerFence.targetDefaultReadOnly === false &&
    writerFence.targetWriteProbeSucceeded === true &&
    writerFence.targetActiveWriterSessions === 0 &&
    writerFence.writerRoles.length > 0;
  if (evidence.phase !== "cutover" || evidence.status !== "matched" ||
    evidence.environment !== "staging" || evidence.comparison.status !== "matched" ||
    evidence.source.sha256 !== evidence.target.sha256 || !evidence.baseline ||
    !validFence || evidence.cutoverId !== env.POSTGRES_CUTOVER_ID?.trim() ||
    evidence.target.logicalId !== env.ENTERPRISE_CUTOVER_TARGET_ID?.trim() ||
    evidence.gitCommit !== env.ENTERPRISE_RUNTIME_GIT_COMMIT?.trim() ||
    evidence.imageDigest !== env.ENTERPRISE_RUNTIME_IMAGE_DIGEST?.trim() ||
    evidence.topologySha256 !== env.ENTERPRISE_RUNTIME_TOPOLOGY_SHA256?.trim() ||
    !same(evidence.target.publicMigrations, [...expectedPostgresMigrations]) ||
    !same(evidence.target.enterpriseMigrations, expectedEnterprise) ||
    !same(Object.keys(evidence.target.critical).sort(),
      [...enterpriseCutoverCriticalTables].sort())) {
    throw new Error("Enterprise PostgreSQL cutover evidence is not production-ready");
  }
  const identity = await client.query<{
    name: string;
    oid: string;
    system_identifier: string;
  }>(`
    SELECT current_database() AS name,
      (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid,
      (pg_control_system()).system_identifier::text AS system_identifier
  `);
  const database = identity.rows[0];
  if (!database || database.name !== evidence.target.database.name ||
    database.oid !== evidence.target.database.oid ||
    database.system_identifier !== evidence.target.database.systemIdentifier) {
    throw new Error("Enterprise PostgreSQL database does not match cutover evidence");
  }
  return {
    status: "ready" as const,
    cutoverId: evidence.cutoverId,
    runId: evidence.runId,
    totalCount: evidence.target.totalCount,
    sha256: evidence.target.sha256,
  };
}

function required(value: string | undefined, name: string) {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required in production`);
  return result;
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
