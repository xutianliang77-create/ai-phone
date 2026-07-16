import { describe, expect, it } from "vitest";
import {
  listActiveEnterpriseMembershipRefs,
  listEnterprisePostgresMemberships,
  resolveEnterprisePostgresContext,
} from "./enterprise-postgres-directory.repository.js";
import type {
  EnterpriseTenantPostgresClient,
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";

const userId = "user_00000000-0000-4000-8000-000000000001";
const tenantId = "00000000-0000-4000-8000-000000000002";
const memberId = "00000000-0000-4000-8000-000000000003";

describe("enterprise PostgreSQL directory repository", () => {
  it("returns only current-user active membership references", async () => {
    const fixture = poolFixture(() => [{
      user_id: userId,
      tenant_id: tenantId,
      member_id: memberId,
      member_status: "active",
    }]);

    await expect(listActiveEnterpriseMembershipRefs(
      fixture.pool,
      userId,
    )).resolves.toEqual([{ tenantId, memberId }]);
    expect(fixture.calls.find(({ sql }) =>
      sql.includes("FROM enterprise.user_tenant_directory")
    )?.values).toEqual([userId]);
  });

  it("rejects a row for a different user or inactive membership", async () => {
    for (const row of [
      {
        user_id: "user_00000000-0000-4000-8000-000000000099",
        tenant_id: tenantId,
        member_id: memberId,
        member_status: "active",
      },
      {
        user_id: userId,
        tenant_id: tenantId,
        member_id: memberId,
        member_status: "suspended",
      },
    ]) {
      const fixture = poolFixture(() => [row]);
      await expect(listActiveEnterpriseMembershipRefs(
        fixture.pool,
        userId,
      )).rejects.toThrow("directory row");
      expect(fixture.calls.at(-1)?.sql).toBe("ROLLBACK");
    }
  });

  it("hydrates directory refs through isolated tenant sessions", async () => {
    const secondTenantId = "00000000-0000-4000-8000-000000000004";
    const secondMemberId = "00000000-0000-4000-8000-000000000005";
    const fixture = poolFixture((sql, values) => {
      if (sql.includes("FROM enterprise.user_tenant_directory")) {
        return [
          directoryRow(tenantId, memberId),
          directoryRow(secondTenantId, secondMemberId),
        ];
      }
      if (sql.includes("FROM enterprise.tenants")) {
        return [tenantRow(String(values?.[0]))];
      }
      if (sql.includes("FROM enterprise.members")) {
        return [memberRow(
          String(values?.[0]),
          String(values?.[0]) === tenantId ? memberId : secondMemberId,
        )];
      }
      return [];
    });

    await expect(resolveEnterprisePostgresContext({
      pool: fixture.pool,
      userId,
      selectedTenantId: tenantId,
      traceId: "trace-a",
    })).resolves.toMatchObject({
      status: "resolved",
      tenant: { id: tenantId },
      member: { id: memberId, userId },
    });
    await expect(resolveEnterprisePostgresContext({
      pool: fixture.pool,
      userId,
      traceId: "trace-b",
    })).resolves.toEqual({ status: "selection_required" });
    await expect(listEnterprisePostgresMemberships({
      pool: fixture.pool,
      userId,
      traceId: "trace-c",
    })).resolves.toHaveLength(2);
  });

  it("does not probe a selected tenant absent from the self directory", async () => {
    const fixture = poolFixture((sql) =>
      sql.includes("FROM enterprise.user_tenant_directory")
        ? [directoryRow(tenantId, memberId)]
        : []
    );
    await expect(resolveEnterprisePostgresContext({
      pool: fixture.pool,
      userId,
      selectedTenantId: "00000000-0000-4000-8000-000000000099",
      traceId: "trace-a",
    })).resolves.toEqual({ status: "access_denied" });
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("FROM enterprise.tenants")
    )).toBe(false);
  });
});

function directoryRow(rowTenantId: string, rowMemberId: string) {
  return {
    user_id: userId,
    tenant_id: rowTenantId,
    member_id: rowMemberId,
    member_status: "active",
  };
}
function tenantRow(rowTenantId: string) {
  return {
    id: rowTenantId,
    name: rowTenantId,
    status: "active",
    home_region: "cn",
    cell_id: "cn-cell-01",
    plan_code: "enterprise_trial",
    trial_ends_at: null,
    billing_customer_ref: null,
    data_retention_days: 30,
    created_at: "2026-07-17T00:00:00.000Z",
    updated_at: "2026-07-17T00:00:00.000Z",
    version: "1",
  };
}
function memberRow(rowTenantId: string, rowMemberId: string) {
  return {
    id: rowMemberId,
    tenant_id: rowTenantId,
    user_id: userId,
    role: "member",
    status: "active",
    joined_at: "2026-07-17T00:00:00.000Z",
    created_at: "2026-07-17T00:00:00.000Z",
    updated_at: "2026-07-17T00:00:00.000Z",
    version: "1",
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
