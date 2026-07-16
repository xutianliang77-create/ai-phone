import { describe, expect, it } from "vitest";
import {
  withEnterpriseDirectoryPostgresSession,
} from "./enterprise-postgres-directory-session.js";
import type {
  EnterpriseTenantPostgresClient,
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";

const userId = "00000000-0000-4000-8000-000000000001";

describe("enterprise PostgreSQL directory session", () => {
  it("sets transaction-local user state and injects user as parameter one", async () => {
    const fixture = poolFixture();
    await withEnterpriseDirectoryPostgresSession(
      fixture.pool,
      userId,
      (session) => session.query(`
        SELECT tenant_id
        FROM enterprise.user_tenant_directory
        WHERE user_id = $1 AND member_status = 'active'
      `),
    );

    expect(fixture.calls).toEqual([
      { sql: "BEGIN", values: undefined },
      {
        sql: "SELECT set_config('app.user_id', $1, true)",
        values: [userId],
      },
      {
        sql: expect.stringContaining("FROM enterprise.user_tenant_directory"),
        values: [userId],
      },
      { sql: "COMMIT", values: undefined },
    ]);
  });

  it("rejects missing user predicates, joins, subqueries and comment bypasses", async () => {
    for (const sql of [
      "SELECT tenant_id FROM enterprise.user_tenant_directory",
      `SELECT directory.tenant_id
       FROM enterprise.user_tenant_directory directory
       JOIN enterprise.members member ON member.id = directory.member_id
       WHERE directory.user_id = $1`,
      `SELECT tenant_id FROM enterprise.user_tenant_directory
       WHERE user_id = $1 AND EXISTS (SELECT 1 FROM enterprise.members)`,
      `SELECT tenant_id FROM enterprise.user_tenant_directory
       WHERE tenant_id = $2 -- user_id = $1`,
      `SELECT tenant_id FROM enterprise.user_tenant_directory
       WHERE user_id = $1 OR true`,
      `SELECT tenant_id FROM enterprise.user_tenant_directory
       WHERE user_id = $1 UNION SELECT $1`,
    ]) {
      const fixture = poolFixture();
      await expect(withEnterpriseDirectoryPostgresSession(
        fixture.pool,
        userId,
        (session) => session.query(sql, ["tenant-a"]),
      )).rejects.toThrow("directory SQL");
      expect(fixture.calls.at(-1)?.sql).toBe("ROLLBACK");
    }
  });
});

function poolFixture() {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client: EnterpriseTenantPostgresClient = {
    async query<Row extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      calls.push({ sql, values });
      return { rows: [] as Row[] };
    },
    release() {},
  };
  const pool: EnterpriseTenantPostgresPool = {
    async connect() {
      return client;
    },
  };
  return { pool, calls };
}
