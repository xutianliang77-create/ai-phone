import { describe, expect, it } from "vitest";
import {
  withEnterpriseTenantPostgresSession,
  type EnterpriseTenantPostgresClient,
  type EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";

describe("enterprise PostgreSQL tenant session", () => {
  it("sets transaction-local tenant state and injects tenant as parameter one", async () => {
    const fixture = poolFixture();
    const result = await withEnterpriseTenantPostgresSession(
      fixture.pool,
      tenantContext(),
      async (session) => {
        await session.queryTenantRecord(
          "SELECT id FROM enterprise.tenants WHERE id = $1",
        );
        await session.query(
          "SELECT id FROM enterprise.members WHERE tenant_id = $1 AND id = $2",
          ["member-a"],
        );
        await session.query(
          "INSERT INTO enterprise.members(tenant_id, id) VALUES ($1, $2)",
          ["member-b"],
        );
        return "done";
      },
    );

    expect(result).toBe("done");
    expect(fixture.calls).toEqual([
      { sql: "BEGIN", values: undefined },
      {
        sql: "SELECT set_config('app.tenant_id', $1, true)",
        values: ["tenant-a"],
      },
      {
        sql: "SELECT id FROM enterprise.tenants WHERE id = $1",
        values: ["tenant-a"],
      },
      {
        sql: "SELECT id FROM enterprise.members WHERE tenant_id = $1 AND id = $2",
        values: ["tenant-a", "member-a"],
      },
      {
        sql: "INSERT INTO enterprise.members(tenant_id, id) VALUES ($1, $2)",
        values: ["tenant-a", "member-b"],
      },
      { sql: "COMMIT", values: undefined },
    ]);
    expect(fixture.released).toBe(true);
  });

  it("rejects tenant root queries that join or omit id parameter one", async () => {
    const wrongTable = poolFixture();
    await expect(withEnterpriseTenantPostgresSession(
      wrongTable.pool,
      tenantContext(),
      (session) => session.queryTenantRecord(
        "SELECT id FROM enterprise.members WHERE id = $1",
      ),
    )).rejects.toThrow("enterprise.tenants");

    const joined = poolFixture();
    await expect(withEnterpriseTenantPostgresSession(
      joined.pool,
      tenantContext(),
      (session) => session.queryTenantRecord(`
        SELECT tenant.id
        FROM enterprise.tenants tenant
        JOIN enterprise.members member ON member.tenant_id = tenant.id
        WHERE tenant.id = $1
      `),
    )).rejects.toThrow("cannot join");

    const subquery = poolFixture();
    await expect(withEnterpriseTenantPostgresSession(
      subquery.pool,
      tenantContext(),
      (session) => session.queryTenantRecord(`
        SELECT id
        FROM enterprise.tenants
        WHERE id = $1 AND EXISTS (SELECT 1 FROM members)
      `),
    )).rejects.toThrow("cannot join");

    const wrongParameter = poolFixture();
    await expect(withEnterpriseTenantPostgresSession(
      wrongParameter.pool,
      tenantContext(),
      (session) => session.queryTenantRecord(
        "SELECT id FROM enterprise.tenants WHERE id = $2",
        ["tenant-a"],
      ),
    )).rejects.toThrow("id = $1");
  });

  it("rejects tenant-owned SQL without an explicit tenant predicate", async () => {
    const fixture = poolFixture();

    await expect(withEnterpriseTenantPostgresSession(
      fixture.pool,
      tenantContext(),
      (session) => session.query(
        "SELECT id FROM enterprise.members WHERE id = $1",
        ["member-a"],
      ),
    )).rejects.toThrow("tenant_id = $1");
    expect(fixture.calls.at(-1)?.sql).toBe("ROLLBACK");
    expect(fixture.released).toBe(true);
  });

  it("rejects comment bypasses and incorrectly ordered tenant inserts", async () => {
    const commented = poolFixture();
    await expect(withEnterpriseTenantPostgresSession(
      commented.pool,
      tenantContext(),
      (session) => session.query(
        "SELECT id FROM enterprise.members WHERE id = $2 -- tenant_id = $1",
        ["member-a"],
      ),
    )).rejects.toThrow("tenant_id = $1");

    const insert = poolFixture();
    await expect(withEnterpriseTenantPostgresSession(
      insert.pool,
      tenantContext(),
      (session) => session.query(
        "INSERT INTO enterprise.members(tenant_id, id) VALUES ($2, $1)",
        ["member-a"],
      ),
    )).rejects.toThrow("insert tenant_id as $1");
  });

  it("rolls back and releases the client when repository work fails", async () => {
    const fixture = poolFixture();

    await expect(withEnterpriseTenantPostgresSession(
      fixture.pool,
      tenantContext(),
      async () => {
        throw new Error("repository failed");
      },
    )).rejects.toThrow("repository failed");
    expect(fixture.calls.map(({ sql }) => sql)).toEqual([
      "BEGIN",
      "SELECT set_config('app.tenant_id', $1, true)",
      "ROLLBACK",
    ]);
    expect(fixture.released).toBe(true);
  });
});

function tenantContext() {
  return createEnterpriseTenantContext({
    tenantId: "tenant-a",
    actorUserId: "user-a",
    actorRole: "owner",
    traceId: "trace-a",
  });
}

function poolFixture() {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const state = { released: false };
  const client: EnterpriseTenantPostgresClient = {
    async query<Row extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      calls.push({ sql, values });
      return { rows: [] as Row[] };
    },
    release() {
      state.released = true;
    },
  };
  const pool: EnterpriseTenantPostgresPool = {
    async connect() {
      return client;
    },
  };
  return {
    pool,
    calls,
    get released() {
      return state.released;
    },
  };
}
