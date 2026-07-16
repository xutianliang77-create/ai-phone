import { describe, expect, it } from "vitest";
import {
  withEnterpriseLifecyclePostgresRepository,
} from "./enterprise-postgres-lifecycle.repository.js";
import type {
  EnterpriseTenantPostgresClient,
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseTenantJobRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const jobId = "00000000-0000-4000-8000-000000000003";
const memberId = "00000000-0000-4000-8000-000000000004";
const now = "2026-07-17T01:00:00.000Z";

describe("enterprise PostgreSQL lifecycle repository", () => {
  it("persists and locks jobs, updates tenant state and suspends members", async () => {
    const fixture = poolFixture((sql) => {
      if (sql.includes("INSERT INTO enterprise.tenant_jobs")) return [jobRow()];
      if (sql.includes("FROM enterprise.tenant_jobs")) return [jobRow()];
      if (sql.includes("attempts = attempts + 1")) {
        return [jobRow({
          attempts: 1,
          lease_expires_at: "2026-07-17T01:00:30.000Z",
          updated_at: now,
        })];
      }
      if (sql.includes("UPDATE enterprise.tenant_jobs")) {
        return [jobRow({
          status: "completed",
          attempts: 1,
          completed_at: now,
          updated_at: now,
        })];
      }
      if (sql.includes("UPDATE enterprise.tenants")) {
        return [tenantRow({ status: "suspended", version: "4" })];
      }
      if (sql.includes("UPDATE enterprise.members")) {
        return [memberRow({ status: "suspended", version: "2" })];
      }
      return [];
    });

    const result = await withEnterpriseLifecyclePostgresRepository(
      fixture.pool,
      context(),
      async (repository) => {
        const inserted = await repository.insertJob(jobRecord());
        const locked = await repository.lockJob(jobId);
        const claimed = await repository.claimJob({
          jobId,
          now,
          leaseExpiresAt: "2026-07-17T01:00:30.000Z",
        });
        const recoverable = await repository.listRecoverableJobs({
          now,
          limit: 10,
        });
        const updated = await repository.updateJob({
          job: {
            ...jobRecord(),
            status: "completed",
            attempts: 1,
            completedAt: now,
            updatedAt: now,
          },
          expectedUpdatedAt: "2026-07-17T00:00:00.000Z",
        });
        const tenant = await repository.updateTenantStatus({
          status: "suspended",
          expectedVersion: 3,
          updatedAt: now,
        });
        const members = await repository.suspendMembers(now);
        return {
          inserted,
          locked,
          claimed,
          recoverable,
          updated,
          tenant,
          members,
        };
      },
    );

    expect(result.inserted).toMatchObject({ status: "created" });
    expect(result.locked).toEqual(jobRecord());
    expect(result.claimed).toMatchObject({
      status: "claimed",
      job: { attempts: 1, leaseExpiresAt: expect.any(String) },
    });
    expect(result.recoverable).toEqual([jobRecord()]);
    expect(result.updated).toMatchObject({
      status: "updated",
      job: { status: "completed", attempts: 1 },
    });
    expect(result.tenant).toMatchObject({
      status: "updated",
      tenant: { status: "suspended", version: 4 },
    });
    expect(result.members).toMatchObject({
      status: "updated",
      members: [{ status: "suspended", version: 2 }],
    });
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("FOR UPDATE")
    )).toBe(true);
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("UPDATE enterprise.user_tenant_directory")
    )).toBe(true);
    expect(fixture.calls.at(-1)?.sql).toBe("COMMIT");
  });

  it("returns stable conflict states without inventing rows", async () => {
    const fixture = poolFixture((sql) =>
      sql.includes("FROM enterprise.tenant_jobs") ? [jobRow()] : []
    );
    const result = await withEnterpriseLifecyclePostgresRepository(
      fixture.pool,
      context(),
      async (repository) => ({
        inserted: await repository.insertJob(jobRecord()),
        locked: await repository.lockJob(jobId),
        claimed: await repository.claimJob({
          jobId,
          now,
          leaseExpiresAt: "2026-07-17T01:00:30.000Z",
        }),
        updated: await repository.updateJob({
          job: jobRecord(),
          expectedUpdatedAt: "2026-07-17T00:00:00.000Z",
        }),
        tenant: await repository.updateTenantStatus({
          status: "suspended",
          expectedVersion: 3,
          updatedAt: now,
        }),
        members: await repository.suspendMembers(now),
      }),
    );

    expect(result).toEqual({
      inserted: { status: "already_exists", job: jobRecord() },
      locked: jobRecord(),
      claimed: { status: "busy" },
      updated: { status: "conflict" },
      tenant: { status: "conflict" },
      members: { status: "unchanged", members: [] },
    });
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("UPDATE enterprise.user_tenant_directory")
    )).toBe(true);
  });

  it("fails closed when an idempotency conflict cannot be read", async () => {
    const fixture = poolFixture(() => []);
    await expect(withEnterpriseLifecyclePostgresRepository(
      fixture.pool,
      context(),
      (repository) => repository.insertJob(jobRecord()),
    )).rejects.toThrow("conflict row is missing");
    expect(fixture.calls.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rejects cross-tenant or different-actor jobs before mutation", async () => {
    for (const job of [
      {
        ...jobRecord(),
        tenantId: "00000000-0000-4000-8000-000000000099",
      },
      {
        ...jobRecord(),
        actorUserId: "00000000-0000-4000-8000-000000000098",
      },
    ]) {
      const fixture = poolFixture(() => []);
      await expect(withEnterpriseLifecyclePostgresRepository(
        fixture.pool,
        context(),
        (repository) => repository.insertJob(job),
      )).rejects.toThrow("lifecycle job");
      expect(fixture.calls.at(-1)?.sql).toBe("ROLLBACK");
    }
  });
});

function context() {
  return createEnterpriseTenantContext({
    tenantId,
    actorUserId: actorId,
    actorRole: "owner",
    traceId: "trace-a",
  });
}

function jobRecord(): EnterpriseTenantJobRecord {
  return {
    id: jobId,
    tenantId,
    actorUserId: actorId,
    type: "tenant.export",
    idempotencyKey: "export-a",
    requestHash: "a".repeat(64),
    status: "processing",
    attempts: 0,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
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
    scope_snapshot: null,
    receipt_ref: null,
    receipt_hash: null,
    completed_at: null,
    created_at: "2026-07-17T00:00:00.000Z",
    updated_at: "2026-07-17T00:00:00.000Z",
    ...overrides,
  };
}

function tenantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: tenantId,
    name: "Tenant A",
    status: "active",
    home_region: "cn",
    cell_id: "cn-cell-01",
    plan_code: "enterprise_trial",
    trial_ends_at: null,
    billing_customer_ref: null,
    data_retention_days: 30,
    created_at: "2026-07-17T00:00:00.000Z",
    updated_at: now,
    version: "3",
    ...overrides,
  };
}

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: memberId,
    tenant_id: tenantId,
    user_id: actorId,
    role: "admin",
    status: "active",
    joined_at: "2026-07-17T00:00:00.000Z",
    created_at: "2026-07-17T00:00:00.000Z",
    updated_at: now,
    version: "1",
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
