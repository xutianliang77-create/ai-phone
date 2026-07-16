import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { SqliteSnapshotStore } from "../../infrastructure/storage/sqlite-snapshot-store.js";

describe("enterprise tenant storage", () => {
  it("persists tenant and member records across a SQLite reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-phone-enterprise-"));
    const file = join(directory, "store.sqlite");
    try {
      const snapshot = createEmptyStoreSnapshot();
      snapshot.enterpriseTenants.push({
        id: "tenant-a",
        name: "Tenant A",
        status: "active",
        homeRegion: "cn",
        planCode: "enterprise_trial",
        dataRetentionDays: 30,
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
        version: 1,
      });
      snapshot.enterpriseMembers.push({
        id: "member-a",
        tenantId: "tenant-a",
        userId: "user-a",
        role: "owner",
        status: "active",
        joinedAt: "2026-07-15T00:00:00.000Z",
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
        version: 1,
      });
      snapshot.enterpriseTenantJobs.push({
        id: "job-a",
        tenantId: "tenant-a",
        actorUserId: "user-a",
        type: "tenant.export",
        idempotencyKey: "export-a",
        requestHash: "hash-a",
        status: "processing",
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
      });
      const writer = new SqliteSnapshotStore(file, createEmptyStoreSnapshot());
      writer.save(snapshot);
      writer.close();

      const reader = new SqliteSnapshotStore(file, createEmptyStoreSnapshot());
      const stored = reader.read();
      reader.close();

      expect(stored.enterpriseTenants).toEqual(snapshot.enterpriseTenants);
      expect(stored.enterpriseMembers).toEqual(snapshot.enterpriseMembers);
      expect(stored.enterpriseTenantJobs).toEqual(snapshot.enterpriseTenantJobs);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
