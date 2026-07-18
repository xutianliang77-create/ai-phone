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
        await session.queryTenantRecord(
          "UPDATE enterprise.tenants SET status = $2 WHERE id = $1 RETURNING id",
          ["suspended"],
        );
        await session.query(
          "SELECT id FROM enterprise.members WHERE tenant_id = $1 AND id = $2",
          ["member-a"],
        );
        await session.query(
          "INSERT INTO enterprise.members(tenant_id, id) VALUES ($1, $2)",
          ["member-b"],
        );
        await session.queryCommunication(
          `SELECT id FROM ai_phone.communication_sessions
           WHERE scope_type = $1 AND scope_id = $2 AND id = $3`,
          ["session-a"],
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
        sql: "SELECT set_config('app.scope_type', 'tenant', true)",
        values: undefined,
      },
      {
        sql: "SELECT set_config('app.scope_id', $1, true)",
        values: ["tenant-a"],
      },
      {
        sql: "SELECT id FROM enterprise.tenants WHERE id = $1",
        values: ["tenant-a"],
      },
      {
        sql: "UPDATE enterprise.tenants SET status = $2 WHERE id = $1 RETURNING id",
        values: ["tenant-a", "suspended"],
      },
      {
        sql: "SELECT id FROM enterprise.members WHERE tenant_id = $1 AND id = $2",
        values: ["tenant-a", "member-a"],
      },
      {
        sql: "INSERT INTO enterprise.members(tenant_id, id) VALUES ($1, $2)",
        values: ["tenant-a", "member-b"],
      },
      {
        sql: `SELECT id FROM ai_phone.communication_sessions
           WHERE scope_type = $1 AND scope_id = $2 AND id = $3`,
        values: ["tenant", "tenant-a", "session-a"],
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

    const unsafeUpdate = poolFixture();
    await expect(withEnterpriseTenantPostgresSession(
      unsafeUpdate.pool,
      tenantContext(),
      (session) => session.queryTenantRecord(
        "UPDATE enterprise.tenants SET status = $1 WHERE version = $2",
        [1],
      ),
    )).rejects.toThrow("id = $1");

    for (const sql of [
      "SELECT id FROM enterprise.tenants WHERE id = $1 OR true",
      "SELECT id FROM enterprise.tenants WHERE id = $1 UNION SELECT $1",
      "UPDATE enterprise.tenants SET status = $2 WHERE id = $1 OR true",
      `UPDATE enterprise.tenants
       SET status = CASE WHEN (SELECT true) THEN $2 ELSE status END
       WHERE id = $1`,
    ]) {
      const ambiguous = poolFixture();
      await expect(withEnterpriseTenantPostgresSession(
        ambiguous.pool,
        tenantContext(),
        (session) => session.queryTenantRecord(sql, ["suspended"]),
      )).rejects.toThrow("tenant record SQL");
    }
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

  it("rejects communication reads without an immutable tenant scope", async () => {
    for (const sql of [
      "SELECT id FROM ai_phone.communication_sessions WHERE id = $3",
      `SELECT id FROM ai_phone.communication_sessions
       WHERE scope_type = $1 AND scope_id = $2 OR true`,
      `SELECT id FROM ai_phone.projection_records
       WHERE scope_type = $1 AND scope_id = $2`,
      `SELECT scope_type = $1, scope_id = $2
       FROM ai_phone.communication_sessions`,
      `SELECT resource.id FROM ai_phone.communication_sessions resource
       JOIN pg_catalog.pg_class hidden ON true
       WHERE resource.scope_type = $1 AND resource.scope_id = $2`,
    ]) {
      const fixture = poolFixture();
      await expect(withEnterpriseTenantPostgresSession(
        fixture.pool,
        tenantContext(),
        (session) => session.queryCommunication(sql, ["resource-a"]),
      )).rejects.toThrow("communication SQL");
    }
  });

  it("allows only scoped communication session mutations", async () => {
    const fixture = poolFixture();
    await withEnterpriseTenantPostgresSession(
      fixture.pool,
      tenantContext(),
      (session) => session.queryCommunicationMutation(
        `INSERT INTO ai_phone.communication_sessions(
          scope_type, scope_id, id, user_id, mode, status,
          consumed_seconds, version, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO NOTHING RETURNING id`,
        ["session-a", "user-a", "meeting", "created", 0, 1, "now", "now"],
      ),
    );
    expect(fixture.calls.at(-2)?.values?.slice(0, 3)).toEqual([
      "tenant",
      "tenant-a",
      "session-a",
    ]);

    for (const sql of [
      `INSERT INTO ai_phone.communication_sessions(
        id, scope_type, scope_id
      ) VALUES ($3, $2, $1) RETURNING id`,
      `UPDATE ai_phone.communication_sessions SET status = $3
       WHERE id = $4 RETURNING id`,
      `DELETE FROM ai_phone.communication_sessions
       WHERE scope_type = $1 AND scope_id = $2`,
      `INSERT INTO ai_phone.session_media_legs(
        scope_type, scope_id, id
      ) VALUES ($1, $2, $3) RETURNING id`,
    ]) {
      const rejected = poolFixture();
      await expect(withEnterpriseTenantPostgresSession(
        rejected.pool,
        tenantContext(),
        (session) => session.queryCommunicationMutation(sql, []),
      )).rejects.toThrow("communication");
    }
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
      "SELECT set_config('app.scope_type', 'tenant', true)",
      "SELECT set_config('app.scope_id', $1, true)",
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
