import { describe, expect, it } from "vitest";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import {
  withEnterpriseTenantPostgresSession,
  type EnterpriseTenantPostgresClient,
} from "./enterprise-postgres-tenant-session.js";

describe("enterprise PostgreSQL tenant dispatch SQL", () => {
  it("allows only tenant-scoped dispatch and capacity mutations", async () => {
    const accepted = fixture();
    await withEnterpriseTenantPostgresSession(
      accepted.pool,
      context(),
      async (session) => {
        await session.queryWorkerDispatch(
          `INSERT INTO ai_phone.worker_dispatches(
            scope_type, scope_id, id, session_id
          ) VALUES ($1, $2, $3, $4) RETURNING id`,
          ["dispatch-a", "session-a"],
        );
        await session.queryWorkerDispatch(
          `UPDATE ai_phone.worker_capacity_reservations SET status = $3
           WHERE scope_type = $1 AND scope_id = $2 AND id = $4 RETURNING id`,
          ["released", "capacity-a"],
        );
      },
    );
    expect(accepted.calls.at(-2)?.values).toEqual([
      "tenant", "tenant-a", "released", "capacity-a",
    ]);

    for (const sql of [
      "SELECT id FROM ai_phone.worker_dispatches WHERE session_id = $3",
      `UPDATE ai_phone.worker_dispatches SET status = $3
       WHERE scope_type = $1 AND id = $4`,
      `DELETE FROM ai_phone.worker_dispatches
       WHERE scope_type = $1 AND scope_id = $2`,
      `SELECT resource.id FROM ai_phone.worker_dispatches resource
       JOIN ai_phone.worker_capacity_reservations capacity
         ON capacity.session_id = resource.session_id
       WHERE resource.scope_type = $1 AND resource.scope_id = $2`,
    ]) {
      const rejected = fixture();
      await expect(withEnterpriseTenantPostgresSession(
        rejected.pool,
        context(),
        (session) => session.queryWorkerDispatch(sql, []),
      )).rejects.toThrow("worker dispatch SQL");
    }
  });
});

function context() {
  return createEnterpriseTenantContext({
    tenantId: "tenant-a",
    actorUserId: "user-a",
    traceId: "trace-a",
  });
}

function fixture() {
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
  return {
    calls,
    pool: { async connect() { return client; } },
  };
}
