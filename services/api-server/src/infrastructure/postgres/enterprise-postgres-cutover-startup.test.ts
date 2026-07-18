import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertEnterprisePostgresCutoverStartup,
} from "./enterprise-postgres-cutover-startup.js";
import {
  enterpriseCutoverCriticalTables,
  type EnterpriseDatabaseManifest,
} from "./enterprise-postgres-database-manifest.js";
import {
  writeEnterpriseCutoverEvidence,
} from "./enterprise-postgres-cutover-evidence.js";
import { loadEnterprisePostgresMigrations } from "./enterprise-postgres-migrations.js";
import { expectedPostgresMigrations } from "../storage/postgres-schema-manifest.js";

describe("enterprise PostgreSQL production cutover startup", () => {
  it("is not required outside production", async () => {
    await expect(assertEnterprisePostgresCutoverStartup({
      async query() {
        throw new Error("must not query");
      },
    }, {})).resolves.toEqual({ status: "not_required" });
  });

  it("accepts only a staging cutover bound to this runtime and database", async () => {
    const fixture = startupFixture();
    await expect(assertEnterprisePostgresCutoverStartup(
      fixture.client("target", "2", "123456"),
      fixture.env,
    )).resolves.toMatchObject({
      status: "ready",
      cutoverId: "cutover-009",
      sha256: "c".repeat(64),
    });
    await expect(assertEnterprisePostgresCutoverStartup(
      fixture.client("wrong", "2", "123456"),
      fixture.env,
    )).rejects.toThrow("does not match cutover evidence");
  });

  it("rejects local-only evidence at the production startup gate", async () => {
    const fixture = startupFixture("local");
    await expect(assertEnterprisePostgresCutoverStartup(
      fixture.client("target", "2", "123456"),
      fixture.env,
    )).rejects.toThrow("not production-ready");
  });
});

function startupFixture(environment: "local" | "staging" = "staging") {
  const directory = mkdtempSync(join(tmpdir(), "enterprise-startup-"));
  const file = join(directory, "cutover.json");
  const key = "enterprise-cutover-test-signing-key-32";
  const source = manifest("source-db", "source", "1");
  const target = manifest("target-db", "target", "2");
  writeEnterpriseCutoverEvidence(file, {
    formatVersion: 1,
    kind: "enterprise_primary_cutover",
    phase: "cutover",
    status: "matched",
    environment,
    runId: "run-009",
    cutoverId: "cutover-009",
    gitCommit: "abcdef1234567",
    imageDigest: `sha256:${"a".repeat(64)}`,
    topologySha256: "b".repeat(64),
    source,
    target,
    comparison: {
      status: "matched",
      sourceSha256: source.sha256,
      targetSha256: target.sha256,
      missingTables: [],
      extraTables: [],
      mismatchedTables: [],
      publicMigrationsMatch: true,
      enterpriseMigrationsMatch: true,
      serverVersionMatch: true,
    },
    baseline: {
      fileSha256: "d".repeat(64),
      sourceSha256: source.sha256,
      sourceWalLsn: source.walLsn,
    },
    writerFence: {
      sourceDefaultReadOnly: true,
      sourceWriteProbeRejected: true,
      sourceActiveWriterSessions: 0,
      targetDefaultReadOnly: false,
      targetWriteProbeSucceeded: true,
      targetActiveWriterSessions: 0,
      writerRoles: ["legacy_writer"],
    },
    capturedAt: "2026-07-18T00:00:00.000Z",
  }, key);
  return {
    env: {
      NODE_ENV: "production",
      ENTERPRISE_CUTOVER_EVIDENCE_FILE: file,
      ENTERPRISE_CUTOVER_EVIDENCE_HMAC_KEY: key,
      POSTGRES_CUTOVER_ID: "cutover-009",
      ENTERPRISE_CUTOVER_TARGET_ID: "target-db",
      ENTERPRISE_RUNTIME_GIT_COMMIT: "abcdef1234567",
      ENTERPRISE_RUNTIME_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
      ENTERPRISE_RUNTIME_TOPOLOGY_SHA256: "b".repeat(64),
    },
    client(name: string, oid: string, systemIdentifier: string) {
      return {
        async query<Row extends Record<string, unknown>>() {
          return { rows: [{
            name,
            oid,
            system_identifier: systemIdentifier,
          }] as Row[] };
        },
      };
    },
  };
}

function manifest(
  logicalId: string,
  name: string,
  oid: string,
): EnterpriseDatabaseManifest {
  const table = { primaryKey: ["id"], count: 0, sha256: "e".repeat(64) };
  const critical = Object.fromEntries(
    enterpriseCutoverCriticalTables.map((tableName) => [tableName, { ...table }]),
  );
  return {
    formatVersion: 1,
    logicalId,
    database: {
      name,
      oid,
      systemIdentifier: "123456",
      serverVersionNum: "160000",
      inRecovery: false,
    },
    snapshot: "1:1:",
    walLsn: "0/1",
    defaultTransactionReadOnly: false,
    publicMigrations: [...expectedPostgresMigrations],
    enterpriseMigrations: loadEnterprisePostgresMigrations().map(({ id, checksum }) => ({
      id,
      checksum,
    })),
    tables: { ...critical },
    critical,
    totalCount: 0,
    sha256: "c".repeat(64),
    capturedAt: "2026-07-18T00:00:00.000Z",
  };
}
