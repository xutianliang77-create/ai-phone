import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertEnterpriseCellObjectReceipt,
  enterpriseCellMigrationMetadata,
  readEnterpriseCellMigrationEvidence,
  readEnterpriseCellObjectReceipt,
  writeEnterpriseCellMigrationEvidence,
  writeEnterpriseCellObjectReceipt,
} from "./enterprise-postgres-cell-evidence.js";
import {
  assertEnterpriseCellWriterFence,
  enterpriseCellWriterFence,
} from "./enterprise-postgres-cell-fence.js";
import {
  compareEnterpriseCellManifests,
  forEachEnterpriseCellPage,
  type EnterpriseCellDataManifest,
} from "./enterprise-postgres-cell-manifest.js";

describe("ENT-DATA-005 signed cell migration evidence", () => {
  it("binds export evidence and object receipts to one tenant and route", () => {
    const directory = mkdtempSync(join(tmpdir(), "enterprise-cell-"));
    const evidenceFile = join(directory, "export.json");
    const receiptFile = join(directory, "objects.json");
    const metadata = enterpriseCellMigrationMetadata(metadataEnv());
    const source = manifest("source-db", "cell-a", 7, 2);
    const receipt = writeEnterpriseCellObjectReceipt(receiptFile, {
      formatVersion: 1,
      kind: "enterprise_cell_object_transfer",
      status: "matched",
      migrationId: metadata.migrationId,
      tenantId: metadata.tenantId,
      sourceCellId: metadata.sourceCellId,
      targetCellId: metadata.targetCellId,
      count: source.objectReferences.count,
      sha256: source.objectReferences.sha256,
      receiptRef: "object-copy-receipt-5005",
      capturedAt: "2026-07-20T08:00:00.000Z",
    }, objectSigningKey);
    const evidence = writeEnterpriseCellMigrationEvidence(evidenceFile, {
      formatVersion: 1,
      kind: "enterprise_cell_migration",
      phase: "export",
      status: "matched",
      metadata,
      source,
      objectReceipt: unsigned(receipt),
      capturedAt: "2026-07-20T08:00:00.000Z",
    }, signingKey);
    expect(readEnterpriseCellMigrationEvidence(evidenceFile, signingKey).evidence)
      .toMatchObject({ phase: "export", metadata: { sourceCellId: "cell-a" } });
    const persistedReceipt = readEnterpriseCellObjectReceipt(
      receiptFile, objectSigningKey,
    );
    expect(() => assertEnterpriseCellObjectReceipt(
      persistedReceipt, metadata, source,
    )).not.toThrow();
    expect(evidence.source.sha256).toBe(source.sha256);
  });

  it("rejects evidence tampering and an object receipt from another route", () => {
    const directory = mkdtempSync(join(tmpdir(), "enterprise-cell-"));
    const file = join(directory, "receipt.json");
    const metadata = enterpriseCellMigrationMetadata(metadataEnv());
    const source = manifest("source-db", "cell-a", 7, 1);
    writeEnterpriseCellObjectReceipt(file, {
      formatVersion: 1,
      kind: "enterprise_cell_object_transfer",
      status: "matched",
      migrationId: metadata.migrationId,
      tenantId: metadata.tenantId,
      sourceCellId: "cell-a",
      targetCellId: "cell-b",
      count: 1,
      sha256: source.objectReferences.sha256,
      receiptRef: "receipt-1",
      capturedAt: "2026-07-20T08:00:00.000Z",
    }, objectSigningKey);
    const receipt = readEnterpriseCellObjectReceipt(file, objectSigningKey);
    expect(() => assertEnterpriseCellObjectReceipt(receipt, {
      ...metadata, targetCellId: "cell-c",
    }, source)).toThrow("does not match");
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    parsed.count = 99;
    writeFileSync(file, JSON.stringify(parsed));
    expect(() => readEnterpriseCellObjectReceipt(file, objectSigningKey))
      .toThrow("signature is invalid");
  });
});

describe("ENT-DATA-005 tenant manifest reconcile", () => {
  it("keeps PostgreSQL bigint JSON lossless across transfer pages", async () => {
    const raw = `{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",` +
      `"tenant_id":"${tenantId}","amount":9007199254740993}`;
    let transferred = "";
    await forEachEnterpriseCellPage({
      async query<Row extends Record<string, unknown>>() {
        return { rows: [{ record_json: raw, canonical_json: raw,
          key_0: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }] as Row[] };
      },
    }, {
      name: "enterprise.usage_ledger",
      schema: "enterprise",
      table: "usage_ledger",
      primaryKey: ["id"],
      insertColumns: ["id", "tenant_id", "amount"],
      dependencies: ["enterprise.tenants"],
      selector: "tenant_id",
      derived: false,
    }, tenantId, 2, (records) => {
      transferred = records[0]!.json;
    });
    expect(transferred).toContain("9007199254740993");
  });

  it("allows only the explicit route epoch change while preserving all hashes", () => {
    const source = manifest("source-db", "cell-a", 7, 0);
    const target = structuredClone(source);
    target.logicalId = "target-db";
    target.database = { ...target.database, name: "target", oid: "2" };
    target.route = { ...target.route, cellId: "cell-b", version: 8 };
    expect(compareEnterpriseCellManifests(source, target)).toMatchObject({
      status: "matched",
      mismatchedTables: [],
    });
  });

  it("identifies record or ledger table divergence", () => {
    const source = manifest("source-db", "cell-a", 7, 0);
    const target = structuredClone(source);
    target.tables["enterprise.usage_ledger"]!.count += 1;
    target.sha256 = "9".repeat(64);
    expect(compareEnterpriseCellManifests(source, target)).toMatchObject({
      status: "mismatch",
      mismatchedTables: ["enterprise.usage_ledger"],
    });
  });
});

describe("ENT-DATA-005 writer fence", () => {
  it("requires source read-only, rejected probes and zero old writers", async () => {
    const fence = await enterpriseCellWriterFence(
      fakeFenceClient("on", true, "0"),
      fakeFenceClient("off", false, "0"),
      ["enterprise_api_writer", "enterprise_worker_writer"],
    );
    expect(() => assertEnterpriseCellWriterFence(fence)).not.toThrow();
    await expect(enterpriseCellWriterFence(
      fakeFenceClient("on", true, "0"),
      fakeFenceClient("off", false, "0"),
      ["INVALID-ROLE"],
    )).rejects.toThrow("writer roles are invalid");
  });

  it("fails when an old source writer remains", async () => {
    const fence = await enterpriseCellWriterFence(
      fakeFenceClient("on", true, "1"),
      fakeFenceClient("off", false, "0"),
      ["enterprise_api_writer"],
    );
    expect(() => assertEnterpriseCellWriterFence(fence))
      .toThrow("writer fence is not established");
  });
});

const signingKey = "enterprise-cell-migration-test-key-32-bytes";
const objectSigningKey = "enterprise-cell-object-receipt-key-32-bytes";
const tenantId = "11111111-1111-4111-8111-111111111111";

function metadataEnv(): NodeJS.ProcessEnv {
  return {
    ENTERPRISE_CELL_MIGRATION_ENVIRONMENT: "staging",
    ENTERPRISE_CELL_MIGRATION_RUN_ID: "run-data-005",
    ENTERPRISE_CELL_MIGRATION_ID: "migration-data-005",
    ENTERPRISE_CELL_MIGRATION_TENANT_ID: tenantId,
    ENTERPRISE_CELL_MIGRATION_SOURCE_CELL_ID: "cell-a",
    ENTERPRISE_CELL_MIGRATION_TARGET_CELL_ID: "cell-b",
    ENTERPRISE_CELL_MIGRATION_SOURCE_ID: "source-db",
    ENTERPRISE_CELL_MIGRATION_TARGET_ID: "target-db",
    ENTERPRISE_CELL_MIGRATION_GIT_COMMIT: "abcdef1234567",
    ENTERPRISE_CELL_MIGRATION_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
    ENTERPRISE_CELL_MIGRATION_TOPOLOGY_SHA256: "b".repeat(64),
  };
}

function manifest(
  logicalId: string,
  cellId: string,
  version: number,
  objectCount: number,
): EnterpriseCellDataManifest {
  const tables = {
    "enterprise.tenants": { primaryKey: ["id"], count: 1, sha256: "1".repeat(64) },
    "enterprise.usage_ledger": {
      primaryKey: ["id"], count: 4, sha256: "2".repeat(64),
    },
  };
  return {
    formatVersion: 1,
    logicalId,
    tenantId,
    database: { name: logicalId, oid: "1", systemIdentifier: "123456",
      serverVersionNum: "160000" },
    route: { homeRegion: "ap-southeast", cellId, version, status: "active" },
    publicMigrations: ["031_communication_resource_scope"],
    enterpriseMigrations: [{ id: "0049", checksum: "3".repeat(64) }],
    tables,
    objectReferences: { count: objectCount, sha256: "4".repeat(64) },
    totalCount: 5,
    sha256: "5".repeat(64),
    capturedAt: "2026-07-20T08:00:00.000Z",
  };
}

function fakeFenceClient(readOnly: "on" | "off", rejectWrite: boolean, count: string) {
  return {
    async query<Row extends Record<string, unknown>>(sql: string) {
      if (sql.startsWith("UPDATE")) {
        if (rejectWrite) throw Object.assign(new Error("read only"), { code: "25006" });
        return { rows: [] as Row[] };
      }
      if (sql.includes("pg_stat_activity")) return { rows: [{ count }] as Row[] };
      return { rows: [{ value: readOnly }] as Row[] };
    },
  };
}

function unsigned<T extends { signature: string }>(value: T) {
  const { signature: _signature, ...result } = value;
  return result;
}
