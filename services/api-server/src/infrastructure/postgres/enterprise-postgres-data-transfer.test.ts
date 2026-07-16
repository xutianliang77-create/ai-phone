import { describe, expect, it, vi } from "vitest";
import type {
  EnterpriseDataSnapshot,
} from "./enterprise-postgres-data-manifest.js";
import {
  enterpriseDataTestSnapshot,
} from "./enterprise-postgres-data-test-fixture.js";
import {
  importEnterprisePostgresData,
  reconcileEnterprisePostgresData,
} from "./enterprise-postgres-data-transfer.js";

describe("enterprise PostgreSQL data transfer", () => {
  it("imports an empty target and commits only after read-back reconcile", async () => {
    const client = clientFixture();
    const source = enterpriseDataTestSnapshot();
    const read = vi.fn()
      .mockResolvedValueOnce(emptyData())
      .mockResolvedValueOnce(source);
    const write = vi.fn().mockResolvedValue(undefined);
    const result = await importEnterprisePostgresData(client, source, {
      read,
      write,
    });
    expect(result.totalCount).toBe(6);
    expect(write).toHaveBeenCalledWith(client, source);
    expect(client.commands).toEqual([
      "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
      "SELECT pg_advisory_xact_lock(hashtext('enterprise-data-import'))",
      "COMMIT",
    ]);
  });

  it("rolls back a nonempty target before writing", async () => {
    const client = clientFixture();
    const write = vi.fn();
    await expect(importEnterprisePostgresData(
      client,
      enterpriseDataTestSnapshot(),
      {
        read: vi.fn().mockResolvedValue(enterpriseDataTestSnapshot()),
        write,
      },
    )).rejects.toThrow("target is not empty");
    expect(write).not.toHaveBeenCalled();
    expect(client.commands.at(-1)).toBe("ROLLBACK");
  });

  it("rolls back when read-back hash differs", async () => {
    const client = clientFixture();
    const source = enterpriseDataTestSnapshot();
    const mismatch = structuredClone(source);
    mismatch.enterpriseOutboxEvents[0]!.attempts = 2;
    await expect(importEnterprisePostgresData(client, source, {
      read: vi.fn()
        .mockResolvedValueOnce(emptyData())
        .mockResolvedValueOnce(mismatch),
      write: vi.fn(),
    })).rejects.toThrow("enterpriseOutboxEvents");
    expect(client.commands.at(-1)).toBe("ROLLBACK");
  });

  it("uses a read-only snapshot for standalone reconcile", async () => {
    const client = clientFixture();
    const source = enterpriseDataTestSnapshot();
    const result = await reconcileEnterprisePostgresData(client, source, {
      read: vi.fn().mockResolvedValue(source),
    });
    expect(result.totalCount).toBe(6);
    expect(client.commands).toEqual([
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "COMMIT",
    ]);
  });
});

function clientFixture() {
  const commands: string[] = [];
  return {
    commands,
    async query<Row extends Record<string, unknown>>(sql: string) {
      commands.push(sql);
      return { rows: [] as Row[] };
    },
  };
}

function emptyData(): EnterpriseDataSnapshot {
  return {
    enterpriseTenants: [],
    enterpriseMembers: [],
    enterpriseTenantJobs: [],
    enterpriseAuditEvents: [],
    enterpriseInboxEvents: [],
    enterpriseOutboxEvents: [],
  };
}
