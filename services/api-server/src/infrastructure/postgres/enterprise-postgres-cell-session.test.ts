import { describe, expect, it } from "vitest";
import {
  withEnterpriseCellPostgresSession,
} from "./enterprise-postgres-cell-session.js";
import type {
  EnterpriseTenantPostgresClient,
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";

const cellId = "cn-cell-01";

describe("enterprise PostgreSQL cell session", () => {
  it("sets cell state and injects cell as parameter one", async () => {
    const fixture = poolFixture();
    await withEnterpriseCellPostgresSession(
      fixture.pool,
      {
        cellId,
        workerId: "worker-a",
        traceId: "trace-a",
      },
      (session) => session.query(`
        SELECT tenant_id, resource_id
        FROM enterprise.platform_pending_work
        WHERE cell_id = $1 AND due_at <= $2
      `, ["2026-07-17T03:00:00.000Z"]),
    );

    expect(fixture.calls).toEqual([
      { sql: "BEGIN", values: undefined },
      {
        sql: "SELECT set_config('app.cell_id', $1, true)",
        values: [cellId],
      },
      {
        sql: "SELECT set_config('app.worker_id', $1, true)",
        values: ["worker-a"],
      },
      {
        sql: "SELECT set_config('app.trace_id', $1, true)",
        values: ["trace-a"],
      },
      {
        sql: expect.stringContaining(
          "FROM enterprise.platform_pending_work",
        ),
        values: [cellId, "2026-07-17T03:00:00.000Z"],
      },
      { sql: "COMMIT", values: undefined },
    ]);
  });

  it("rejects cross-table and ambiguous discovery SQL", async () => {
    for (const sql of [
      "SELECT id FROM enterprise.outbox_events WHERE cell_id = $1",
      "SELECT tenant_id FROM enterprise.platform_pending_work",
      `SELECT pending.tenant_id
       FROM enterprise.platform_pending_work pending
       JOIN enterprise.tenants tenant ON tenant.id = pending.tenant_id
       WHERE pending.cell_id = $1`,
      `SELECT tenant_id FROM enterprise.platform_pending_work
       WHERE cell_id = $1 AND EXISTS (
         SELECT 1 FROM enterprise.outbox_events
       )`,
      `SELECT tenant_id FROM enterprise.platform_pending_work
       WHERE tenant_id = $2 -- cell_id = $1`,
      `SELECT tenant_id FROM enterprise.platform_pending_work
       WHERE cell_id = $1 OR true`,
      `SELECT tenant_id FROM enterprise.platform_pending_work
       WHERE cell_id = $1 UNION SELECT $1`,
    ]) {
      const fixture = poolFixture();
      await expect(withEnterpriseCellPostgresSession(
        fixture.pool,
        { cellId, workerId: "worker-a", traceId: "trace-a" },
        (session) => session.query(sql, ["tenant-a"]),
      )).rejects.toThrow("cell SQL");
      expect(fixture.calls.at(-1)?.sql).toBe("ROLLBACK");
    }
  });

  it("allows only scoped coordination-column updates", async () => {
    const fixture = poolFixture();
    await withEnterpriseCellPostgresSession(
      fixture.pool,
      { cellId, workerId: "worker-a", traceId: "trace-claim" },
      (session) => session.queryCoordination(`
        UPDATE enterprise.platform_pending_work
        SET coordination_owner = $2,
          coordination_generation = coordination_generation + 1,
          coordination_lease_expires_at = $3
        WHERE cell_id = $1 AND resource_id = $4::uuid
        RETURNING coordination_generation
      `, ["worker-a", "2026-07-20T04:00:30.000Z", "id"]),
    );
    expect(fixture.calls.some(({ sql, values }) =>
      sql.includes("coordination_generation + 1") && values?.[0] === cellId
    )).toBe(true);

    const rejected = poolFixture();
    await expect(withEnterpriseCellPostgresSession(
      rejected.pool,
      { cellId, workerId: "worker-a", traceId: "trace-invalid" },
      (session) => session.queryCoordination(`
        UPDATE enterprise.platform_pending_work
        SET due_at = $2
        WHERE cell_id = $1
        RETURNING resource_id
      `, ["2026-07-20T04:00:30.000Z"]),
    )).rejects.toThrow("coordination update");
    expect(rejected.calls.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rejects invalid cell identifiers before opening a connection", async () => {
    const fixture = poolFixture();
    await expect(withEnterpriseCellPostgresSession(
      fixture.pool,
      {
        cellId: "cn cell 01",
        workerId: "worker-a",
        traceId: "trace-a",
      },
      async () => undefined,
    )).rejects.toThrow("cellId");
    expect(fixture.calls).toEqual([]);
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
