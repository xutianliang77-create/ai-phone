import { describe, expect, it } from "vitest";
import {
  enterpriseDataTestSnapshot,
} from "./enterprise-postgres-data-test-fixture.js";
import {
  writeEnterprisePostgresData,
} from "./enterprise-postgres-data-write.js";

describe("enterprise PostgreSQL data writer", () => {
  it("writes all six collections in dependency order", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      async query<Row extends Record<string, unknown>>(
        sql: string,
        values?: unknown[],
      ) {
        calls.push({ sql, values });
        return { rows: [] as Row[] };
      },
    };
    await writeEnterprisePostgresData(client, enterpriseDataTestSnapshot());
    expect(calls.map(({ sql }) => sql.match(
      /INSERT INTO enterprise\.([a-z_]+)/,
    )?.[1])).toEqual([
      "tenants",
      "members",
      "tenant_jobs",
      "audit_events",
      "inbox_events",
      "outbox_events",
    ]);
  });

  it("rejects missing tenant relationships before any mutation", async () => {
    const snapshot = enterpriseDataTestSnapshot();
    snapshot.enterpriseMembers[0]!.tenantId =
      "00000000-0000-4000-8000-000000000099";
    let queries = 0;
    await expect(writeEnterprisePostgresData({
      async query<Row extends Record<string, unknown>>() {
        queries += 1;
        return { rows: [] as Row[] };
      },
    }, snapshot)).rejects.toThrow("missing tenant");
    expect(queries).toBe(0);
  });
});
