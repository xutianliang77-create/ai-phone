import { describe, expect, it } from "vitest";
import {
  claimEnterprisePostgresPendingWork,
  listEnterprisePostgresPendingWork,
  type EnterprisePostgresPendingWorkRef,
} from "./enterprise-postgres-pending-work.repository.js";
import type {
  EnterpriseTenantPostgresClient,
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";

const cellId = "cn-cell-01";
const tenantId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const jobId = "00000000-0000-4000-8000-000000000003";
const outboxId = "00000000-0000-4000-8000-000000000004";
const now = "2026-07-17T03:00:00.000Z";
const leaseExpiresAt = "2026-07-17T03:00:30.000Z";

describe("enterprise PostgreSQL pending work", () => {
  it("discovers only minimal due references for the configured cell", async () => {
    const fixture = poolFixture((sql) =>
      sql.includes("platform_pending_work")
        ? [
            pendingRow(),
            pendingRow({
              work_kind: "outbox",
              resource_id: outboxId,
              actor_id: null,
            }),
          ]
        : []
    );

    const refs = await listEnterprisePostgresPendingWork({
      pool: fixture.pool,
      cellId,
      workerId: "worker-a",
      traceId: "trace-discovery",
      now,
      limit: 20,
    });

    expect(refs).toEqual([
      lifecycleRef(),
      {
        cellId,
        tenantId,
        workKind: "outbox",
        resourceId: outboxId,
      },
    ]);
    expect(fixture.calls.find(({ sql }) =>
      sql.includes("platform_pending_work")
    )?.values).toEqual([cellId, now, 20]);
  });

  it("rejects wrong-cell or malformed projection rows", async () => {
    for (const row of [
      pendingRow({ cell_id: "cn-cell-02" }),
      pendingRow({ actor_id: null }),
      pendingRow({ work_kind: "outbox" }),
      pendingRow({ work_kind: "unknown" }),
    ]) {
      const fixture = poolFixture((sql) =>
        sql.includes("platform_pending_work") ? [row] : []
      );
      await expect(listEnterprisePostgresPendingWork({
        pool: fixture.pool,
        cellId,
        workerId: "worker-a",
        traceId: "trace-invalid-row",
        now,
        limit: 10,
      })).rejects.toThrow(/pending work/);
      expect(fixture.calls.at(-1)?.sql).toBe("ROLLBACK");
    }
  });

  it("claims lifecycle and outbox work in isolated tenant transactions", async () => {
    const lifecycle = poolFixture((sql) => {
      if (sql.includes("FROM enterprise.tenants")) return [tenantRow()];
      if (sql.includes("UPDATE enterprise.tenant_jobs")) {
        return [jobRow({
          attempts: 1,
          lease_expires_at: leaseExpiresAt,
          updated_at: now,
        })];
      }
      return [];
    });
    const lifecycleClaim = await claimEnterprisePostgresPendingWork({
      pool: lifecycle.pool,
      cellId,
      ref: lifecycleRef(),
      now,
      leaseExpiresAt,
      traceId: "trace-lifecycle",
    });
    expect(lifecycleClaim).toMatchObject({
      workKind: "tenant_lifecycle",
      result: { status: "claimed", job: { id: jobId, attempts: 1 } },
    });
    expect(lifecycle.calls.some(({ sql, values }) =>
      sql.includes("set_config('app.tenant_id'") &&
      values?.[0] === tenantId
    )).toBe(true);
    expect(lifecycle.calls.some(({ sql }) =>
      sql.includes("FROM enterprise.tenants") &&
      sql.includes("FOR UPDATE")
    )).toBe(true);

    const outbox = poolFixture((sql) => {
      if (sql.includes("FROM enterprise.tenants")) return [tenantRow()];
      if (sql.includes("UPDATE enterprise.outbox_events")) {
        return [outboxRow({
          attempts: 1,
          lease_expires_at: leaseExpiresAt,
        })];
      }
      return [];
    });
    const outboxClaim = await claimEnterprisePostgresPendingWork({
      pool: outbox.pool,
      cellId,
      ref: {
        cellId,
        tenantId,
        workKind: "outbox",
        resourceId: outboxId,
      },
      now,
      leaseExpiresAt,
      traceId: "trace-outbox",
    });
    expect(outboxClaim).toMatchObject({
      workKind: "outbox",
      result: { status: "claimed", event: { id: outboxId, attempts: 1 } },
    });
  });

  it("fails closed before claim when the tenant route changed", async () => {
    const fixture = poolFixture((sql) =>
      sql.includes("FROM enterprise.tenants")
        ? [tenantRow({ cell_id: "cn-cell-02" })]
        : []
    );
    await expect(claimEnterprisePostgresPendingWork({
      pool: fixture.pool,
      cellId,
      ref: lifecycleRef(),
      now,
      leaseExpiresAt,
      traceId: "trace-mismatch",
    })).rejects.toThrow("tenant cell mismatch");
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("UPDATE enterprise.tenant_jobs")
    )).toBe(false);
    expect(fixture.calls.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rejects an expired lease or mismatched reference before connection", async () => {
    for (const input of [
      {
        cellId,
        ref: { ...lifecycleRef(), cellId: "cn-cell-02" },
        leaseExpiresAt,
      },
      {
        cellId,
        ref: lifecycleRef(),
        leaseExpiresAt: now,
      },
    ]) {
      const fixture = poolFixture(() => []);
      await expect(claimEnterprisePostgresPendingWork({
        pool: fixture.pool,
        ...input,
        now,
        traceId: "trace-invalid",
      })).rejects.toThrow(/cell mismatch|lease/);
      expect(fixture.calls).toEqual([]);
    }
  });
});

function lifecycleRef(): EnterprisePostgresPendingWorkRef {
  return {
    cellId,
    tenantId,
    workKind: "tenant_lifecycle",
    resourceId: jobId,
    actorUserId: actorId,
  };
}

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    cell_id: cellId,
    tenant_id: tenantId,
    work_kind: "tenant_lifecycle",
    resource_id: jobId,
    actor_id: actorId,
    ...overrides,
  };
}

function tenantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: tenantId,
    name: "Tenant A",
    status: "active",
    home_region: "cn",
    cell_id: cellId,
    plan_code: "enterprise_trial",
    trial_ends_at: null,
    billing_customer_ref: null,
    data_retention_days: 30,
    created_at: now,
    updated_at: now,
    version: "1",
    ...overrides,
  };
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: jobId,
    tenant_id: tenantId,
    actor_id: actorId,
    job_type: "tenant.export",
    idempotency_key: "export-a",
    request_hash: "a".repeat(64),
    status: "processing",
    attempts: 0,
    error_code: null,
    lease_expires_at: null,
    next_attempt_at: null,
    scope_snapshot: { requestedAt: now },
    receipt_ref: null,
    receipt_hash: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: outboxId,
    tenant_id: tenantId,
    aggregate_type: "contact",
    aggregate_id: jobId,
    event_type: "crm.contact.sync",
    idempotency_key: "sync-contact-a",
    payload: { contactId: "contact-a" },
    trace_id: "trace-outbox",
    attempts: 0,
    available_at: now,
    lease_expires_at: null,
    last_error_code: null,
    created_at: now,
    published_at: null,
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
    async connect() {
      return client;
    },
  };
  return { pool, calls };
}
