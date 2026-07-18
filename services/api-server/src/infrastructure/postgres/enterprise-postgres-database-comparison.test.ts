import { describe, expect, it } from "vitest";
import {
  compareEnterpriseDatabaseManifests,
} from "./enterprise-postgres-database-comparison.js";
import type {
  EnterpriseDatabaseManifest,
} from "./enterprise-postgres-database-manifest.js";

describe("enterprise PostgreSQL full database comparison", () => {
  it("matches equal manifests and identifies table-level divergence", () => {
    const source = manifest();
    expect(compareEnterpriseDatabaseManifests(source, structuredClone(source)))
      .toMatchObject({ status: "matched", mismatchedTables: [] });

    const target = structuredClone(source);
    target.tables["enterprise.tenants"]!.count = 2;
    target.sha256 = "b".repeat(64);
    expect(compareEnterpriseDatabaseManifests(source, target)).toMatchObject({
      status: "mismatch",
      mismatchedTables: ["enterprise.tenants"],
    });
  });
});

function manifest(): EnterpriseDatabaseManifest {
  const table = { primaryKey: ["id"], count: 1, sha256: "c".repeat(64) };
  return {
    formatVersion: 1,
    logicalId: "source-db",
    database: {
      name: "source",
      oid: "1",
      systemIdentifier: "123456",
      serverVersionNum: "160000",
      inRecovery: false,
    },
    snapshot: "1:1:",
    walLsn: "0/1",
    defaultTransactionReadOnly: false,
    publicMigrations: ["001"],
    enterpriseMigrations: [{ id: "001", checksum: "d".repeat(64) }],
    tables: { "enterprise.tenants": { ...table } },
    critical: { "enterprise.tenants": { ...table } },
    totalCount: 1,
    sha256: "a".repeat(64),
    capturedAt: "2026-07-18T00:00:00.000Z",
  };
}
