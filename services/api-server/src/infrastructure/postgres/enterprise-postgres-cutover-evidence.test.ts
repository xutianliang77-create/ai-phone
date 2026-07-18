import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  enterpriseCutoverMetadata,
  readEnterpriseCutoverEvidence,
  writeEnterpriseCutoverEvidence,
} from "./enterprise-postgres-cutover-evidence.js";
import type { EnterpriseDatabaseManifest } from "./enterprise-postgres-database-manifest.js";

describe("enterprise PostgreSQL signed cutover evidence", () => {
  it("validates metadata, persists atomically and rejects tampering", () => {
    const metadata = enterpriseCutoverMetadata(metadataEnv());
    expect(metadata.environment).toBe("staging");
    const file = join(mkdtempSync(join(tmpdir(), "enterprise-cutover-")), "evidence.json");
    const source = manifest("source-db", "source", "1");
    const target = manifest("target-db", "target", "2");
    writeEnterpriseCutoverEvidence(file, {
      formatVersion: 1,
      kind: "enterprise_primary_cutover",
      phase: "baseline",
      status: "matched",
      ...metadata,
      source,
      target,
      comparison: comparison(source.sha256),
      capturedAt: "2026-07-18T00:00:00.000Z",
    }, signingKey);
    expect(readEnterpriseCutoverEvidence(file, signingKey).cutoverId).toBe("cutover-009");

    const parsed = JSON.parse(readFileSync(file, "utf8"));
    parsed.target.totalCount = 99;
    writeFileSync(file, JSON.stringify(parsed));
    expect(() => readEnterpriseCutoverEvidence(file, signingKey))
      .toThrow("signature is invalid");
  });

  it("fails closed on weak or malformed identity metadata", () => {
    expect(() => enterpriseCutoverMetadata({
      ...metadataEnv(),
      ENTERPRISE_CUTOVER_IMAGE_DIGEST: "latest",
    })).toThrow("must be a sha256 digest");
    expect(() => readEnterpriseCutoverEvidence("missing.json", "short"))
      .toThrow("signing key is too short");
  });
});

const signingKey = "enterprise-cutover-test-signing-key-32";

function metadataEnv(): NodeJS.ProcessEnv {
  return {
    ENTERPRISE_CUTOVER_ENVIRONMENT: "staging",
    ENTERPRISE_CUTOVER_RUN_ID: "run-009",
    POSTGRES_CUTOVER_ID: "cutover-009",
    ENTERPRISE_CUTOVER_GIT_COMMIT: "abcdef1234567",
    ENTERPRISE_CUTOVER_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
    ENTERPRISE_CUTOVER_TOPOLOGY_SHA256: "b".repeat(64),
  };
}

function manifest(logicalId: string, name: string, oid: string): EnterpriseDatabaseManifest {
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
    publicMigrations: [],
    enterpriseMigrations: [],
    tables: {},
    critical: {},
    totalCount: 0,
    sha256: "c".repeat(64),
    capturedAt: "2026-07-18T00:00:00.000Z",
  };
}

function comparison(sha256: string) {
  return {
    status: "matched" as const,
    sourceSha256: sha256,
    targetSha256: sha256,
    missingTables: [],
    extraTables: [],
    mismatchedTables: [],
    publicMigrationsMatch: true,
    enterpriseMigrationsMatch: true,
    serverVersionMatch: true,
  };
}
