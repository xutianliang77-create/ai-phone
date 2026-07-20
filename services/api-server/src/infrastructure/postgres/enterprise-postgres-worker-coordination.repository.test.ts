import { describe, expect, it } from "vitest";
import type {
  EnterpriseTenantPostgresClient,
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";
import {
  claimEnterprisePostgresPendingWorkBatch,
  releaseEnterprisePostgresPendingWorkClaim,
  renewEnterprisePostgresPendingWorkClaim,
  type EnterprisePostgresPendingWorkClaim,
} from "./enterprise-postgres-worker-coordination.repository.js";

const cellId = "cn-cell-01";
const workerId = "worker-a";
const tenantId = "00000000-0000-4000-8000-000000000001";
const resourceId = "00000000-0000-4000-8000-000000000002";
const leaseExpiresAt = "2026-07-20T04:00:30.000Z";

describe("enterprise PostgreSQL worker coordination", () => {
  it("atomically claims a cell queue batch with skip-locked fencing", async () => {
    const fixture = poolFixture((sql) =>
      sql.includes("FOR UPDATE SKIP LOCKED") ? [coordinationRow()] : []
    );

    const claims = await claimEnterprisePostgresPendingWorkBatch({
      pool: fixture.pool,
      cellId,
      workerId,
      traceId: "trace-claim",
      leaseMs: 30_000,
      limit: 20,
    });

    expect(claims).toEqual([claim()]);
    const update = fixture.calls.find(({ sql }) =>
      sql.includes("FOR UPDATE SKIP LOCKED")
    );
    expect(update?.sql).toContain("coordination_generation + 1");
    expect(update?.values).toEqual([
      cellId,
      20,
      workerId,
      30_000,
    ]);
  });

  it("returns no claim to a competing instance after rows were skipped", async () => {
    const fixture = poolFixture(() => []);
    await expect(claimEnterprisePostgresPendingWorkBatch({
      pool: fixture.pool,
      cellId,
      workerId: "worker-b",
      traceId: "trace-competing",
      leaseMs: 30_000,
      limit: 10,
    })).resolves.toEqual([]);
  });

  it("renews and releases only the current owner and generation", async () => {
    const fixture = poolFixture((sql) =>
      sql.includes("RETURNING coordination_generation")
        ? [{ coordination_generation: "7" }]
        : []
    );
    const current = claim({ generation: "7" });
    const renewed = await renewEnterprisePostgresPendingWorkClaim({
      pool: fixture.pool,
      claim: current,
      traceId: "trace-renew",
      leaseMs: 30_000,
    });
    const released = await releaseEnterprisePostgresPendingWorkClaim({
      pool: fixture.pool,
      claim: current,
      traceId: "trace-release",
    });

    expect(renewed).toBe(true);
    expect(released).toBe(true);
    expect(fixture.calls.some(({ sql, values }) =>
      sql.includes("coordination_lease_expires_at > clock_timestamp()") &&
      values?.[5] === "7" && values?.[6] === 30_000
    )).toBe(true);
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("coordination_owner = NULL")
    )).toBe(true);
  });

  it("fails closed for malformed claims and expired lease requests", async () => {
    const malformed = poolFixture((sql) =>
      sql.includes("FOR UPDATE SKIP LOCKED")
        ? [coordinationRow({ coordination_owner: "worker-b" })]
        : []
    );
    await expect(claimEnterprisePostgresPendingWorkBatch({
      pool: malformed.pool,
      cellId,
      workerId,
      traceId: "trace-malformed",
      leaseMs: 30_000,
      limit: 10,
    })).rejects.toThrow("coordination claim");
    expect(malformed.calls.at(-1)?.sql).toBe("ROLLBACK");

    const unopened = poolFixture(() => []);
    await expect(claimEnterprisePostgresPendingWorkBatch({
      pool: unopened.pool,
      cellId,
      workerId,
      traceId: "trace-expired",
      leaseMs: 999,
      limit: 10,
    })).rejects.toThrow("lease duration");
    expect(unopened.calls).toEqual([]);
  });

  it("treats a stale generation release as a no-op", async () => {
    const fixture = poolFixture(() => []);
    await expect(releaseEnterprisePostgresPendingWorkClaim({
      pool: fixture.pool,
      claim: claim({ generation: "6" }),
      traceId: "trace-stale",
    })).resolves.toBe(false);
  });
});

function claim(
  overrides: Partial<EnterprisePostgresPendingWorkClaim["coordination"]> = {},
): EnterprisePostgresPendingWorkClaim {
  return {
    cellId,
    tenantId,
    workKind: "outbox",
    resourceId,
    coordination: {
      workerId,
      generation: "1",
      leaseExpiresAt,
      ...overrides,
    },
  };
}

function coordinationRow(overrides: Record<string, unknown> = {}) {
  return {
    cell_id: cellId,
    tenant_id: tenantId,
    work_kind: "outbox",
    resource_id: resourceId,
    actor_id: null,
    coordination_owner: workerId,
    coordination_generation: "1",
    coordination_lease_expires_at: leaseExpiresAt,
    ...overrides,
  };
}

function poolFixture(
  rowsFor: (sql: string, values?: unknown[]) => Record<string, unknown>[],
) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client: EnterpriseTenantPostgresClient = {
    async query<Row extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      calls.push({ sql, values });
      return { rows: rowsFor(sql, values) as Row[] };
    },
    release() {},
  };
  const pool: EnterpriseTenantPostgresPool = {
    async connect() { return client; },
  };
  return { pool, calls };
}
