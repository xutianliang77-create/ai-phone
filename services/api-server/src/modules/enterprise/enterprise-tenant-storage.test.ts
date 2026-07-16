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
        attempts: 0,
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
      });
      snapshot.enterpriseAuditEvents.push({
        id: "audit-a",
        tenantId: "tenant-a",
        actorUserId: "user-a",
        action: "tenant.export",
        resourceType: "tenant",
        resourceId: "tenant-a",
        result: "accepted",
        details: { jobId: "job-a" },
        traceId: "trace-a",
        createdAt: "2026-07-15T00:00:00.000Z",
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
      expect(stored.enterpriseAuditEvents).toEqual(snapshot.enterpriseAuditEvents);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects SQLite audit event updates and deletions", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-phone-enterprise-audit-"));
    const file = join(directory, "store.sqlite");
    try {
      const writer = new SqliteSnapshotStore(file, createEmptyStoreSnapshot());
      const snapshot = writer.read();
      snapshot.enterpriseAuditEvents.push({
        id: "audit-immutable",
        tenantId: "tenant-a",
        actorUserId: "user-a",
        action: "member.create",
        resourceType: "member",
        resourceId: "member-a",
        result: "completed",
        details: {},
        traceId: "trace-immutable",
        createdAt: "2026-07-15T00:00:00.000Z",
      });
      writer.save(snapshot);
      snapshot.enterpriseAuditEvents[0]!.result = "failed";
      expect(() => writer.save(snapshot)).toThrow("append-only");
      writer.close();

      const remover = new SqliteSnapshotStore(file, createEmptyStoreSnapshot());
      const stored = remover.read();
      stored.enterpriseAuditEvents = [];
      expect(() => remover.save(stored)).toThrow("append-only");
      remover.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
