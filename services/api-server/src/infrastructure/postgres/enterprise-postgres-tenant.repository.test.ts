import { describe, expect, it } from "vitest";
import {
  withEnterpriseTenantPostgresRepository,
} from "./enterprise-postgres-tenant.repository.js";
import type {
  EnterpriseTenantPostgresClient,
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseAuditEventRecord,
  EnterpriseMemberRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const ownerId = "user_00000000-0000-4000-8000-000000000002";
const memberId = "00000000-0000-4000-8000-000000000003";
const userId = "user_00000000-0000-4000-8000-000000000004";
const auditId = "00000000-0000-4000-8000-000000000005";
const now = "2026-07-17T00:00:00.000Z";

describe("enterprise PostgreSQL tenant repository", () => {
  it("maps tenant/member/audit rows inside one tenant transaction", async () => {
    const fixture = poolFixture((sql) => {
      if (sql.includes("FROM enterprise.tenants")) return [tenantRow()];
      if (sql.includes("INSERT INTO enterprise.members")) return [memberRow()];
      if (sql.includes("UPDATE enterprise.members")) {
        return [memberRow({ role: "auditor", version: "2" })];
      }
      if (sql.includes("FROM enterprise.members")) return [memberRow()];
      if (sql.includes("FROM enterprise.audit_events")) {
        return [
          auditRow(),
          auditRow({
            id: "00000000-0000-4000-8000-000000000006",
            created_at: "2026-07-16T23:59:00.000Z",
          }),
        ];
      }
      return [];
    });

    const result = await withEnterpriseTenantPostgresRepository(
      fixture.pool,
      context(),
      async (repository) => {
        const tenant = await repository.findTenant();
        const members = await repository.listMembers();
        const memberByUser = await repository.findMemberByUserId(userId);
        const inserted = await repository.insertMember(memberRecord());
        const updated = await repository.updateMember({
          memberId,
          expectedVersion: 1,
          role: "auditor",
          updatedAt: now,
        });
        await repository.appendAuditEvent(auditRecord());
        const audit = await repository.listAuditEvents({
          limit: 1,
          action: "member.update",
          before: {
            createdAt: "2026-07-17T00:01:00.000Z",
            id: "00000000-0000-4000-8000-000000000099",
          },
        });
        return { tenant, members, memberByUser, inserted, updated, audit };
      },
    );

    expect(result.tenant).toMatchObject({
      id: tenantId,
      status: "active",
      version: 3,
    });
    expect(result.members).toEqual([memberRecord()]);
    expect(result.memberByUser).toEqual(memberRecord());
    expect(result.inserted).toEqual({
      status: "created",
      member: memberRecord(),
    });
    expect(result.updated).toMatchObject({
      status: "updated",
      member: { role: "auditor", version: 2 },
    });
    expect(result.audit).toEqual({
      events: [auditRecord()],
      nextPosition: { createdAt: now, id: auditId },
    });
    expect(fixture.calls[2]).toMatchObject({
      values: [tenantId],
    });
    expect(fixture.calls.find(({ sql }) =>
      sql.includes("INSERT INTO enterprise.members")
    )?.values?.slice(0, 3)).toEqual([tenantId, memberId, userId]);
    expect(fixture.calls.filter(({ sql }) =>
      sql.includes("INSERT INTO enterprise.user_tenant_directory")
    )).toHaveLength(2);
    expect(fixture.calls.find(({ sql }) =>
      sql.includes("FROM enterprise.audit_events")
    )?.values).toEqual([
      tenantId,
      "member.update",
      "2026-07-17T00:01:00.000Z",
      "00000000-0000-4000-8000-000000000099",
      2,
    ]);
    expect(fixture.calls.at(-1)?.sql).toBe("COMMIT");
  });

  it("returns duplicate/conflict without manufacturing records", async () => {
    const fixture = poolFixture((sql) =>
      sql.includes("FOR UPDATE")
        ? [memberRow({ version: "6" })]
        : []
    );

    const result = await withEnterpriseTenantPostgresRepository(
      fixture.pool,
      context(),
      async (repository) => ({
        inserted: await repository.insertMember(memberRecord()),
        updated: await repository.updateMember({
          memberId,
          expectedVersion: 7,
          status: "suspended",
          updatedAt: now,
        }),
      }),
    );

    expect(result).toEqual({
      inserted: { status: "already_exists" },
      updated: { status: "conflict" },
    });
  });

  it("distinguishes a missing member and protects the owner under lock", async () => {
    const missing = poolFixture(() => []);
    const missingResult = await withEnterpriseTenantPostgresRepository(
      missing.pool,
      context(),
      (repository) => repository.updateMember({
        memberId,
        expectedVersion: 1,
        status: "suspended",
        updatedAt: now,
      }),
    );
    expect(missingResult).toEqual({ status: "not_found" });

    const owner = poolFixture((sql) =>
      sql.includes("FOR UPDATE")
        ? [memberRow({ role: "owner" })]
        : []
    );
    const ownerResult = await withEnterpriseTenantPostgresRepository(
      owner.pool,
      context(),
      (repository) => repository.updateMember({
        memberId,
        expectedVersion: 1,
        status: "suspended",
        updatedAt: now,
      }),
    );
    expect(ownerResult).toMatchObject({
      status: "owner_protected",
      member: { role: "owner" },
    });
    expect(owner.calls.some(({ sql }) =>
      sql.includes("UPDATE enterprise.members")
    )).toBe(false);
  });

  it("rejects cross-tenant or malformed account records before mutation", async () => {
    for (const member of [
      {
        ...memberRecord(),
        tenantId: "00000000-0000-4000-8000-000000000099",
      },
      { ...memberRecord(), userId: "user-a" },
    ]) {
      const fixture = poolFixture(() => []);
      await expect(withEnterpriseTenantPostgresRepository(
        fixture.pool,
        context(),
        (repository) => repository.insertMember(member),
      )).rejects.toThrow(/tenant mismatch|account subject/);
      expect(fixture.calls.at(-1)?.sql).toBe("ROLLBACK");
    }
  });

  it("rejects a cross-tenant row returned by the database", async () => {
    const fixture = poolFixture((sql) =>
      sql.includes("FROM enterprise.members")
        ? [memberRow({
            tenant_id: "00000000-0000-4000-8000-000000000099",
          })]
        : []
    );
    await expect(withEnterpriseTenantPostgresRepository(
      fixture.pool,
      context(),
      (repository) => repository.listMembers(),
    )).rejects.toThrow("tenant mismatch");
    expect(fixture.calls.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rejects a member-by-user row for a different user", async () => {
    const fixture = poolFixture((sql) =>
      sql.includes("FROM enterprise.members")
        ? [memberRow({
            user_id: "user_00000000-0000-4000-8000-000000000099",
          })]
        : []
    );

    await expect(withEnterpriseTenantPostgresRepository(
      fixture.pool,
      context(),
      (repository) => repository.findMemberByUserId(userId),
    )).rejects.toThrow("user mismatch");
  });

  it("rolls back an appended audit event when later work fails", async () => {
    const fixture = poolFixture(() => []);

    await expect(withEnterpriseTenantPostgresRepository(
      fixture.pool,
      context(),
      async (repository) => {
        await repository.appendAuditEvent({
          ...auditRecord(),
          actorUserId: "system:webhook",
        });
        throw new Error("domain failed");
      },
    )).rejects.toThrow("domain failed");
    expect(fixture.calls.at(-2)?.sql).toContain(
      "INSERT INTO enterprise.audit_events",
    );
    expect(fixture.calls.at(-1)?.sql).toBe("ROLLBACK");
  });
});
function context() {
  return createEnterpriseTenantContext({
    tenantId,
    actorUserId: ownerId,
    actorRole: "owner",
    traceId: "trace-a",
  });
}
function memberRecord(): EnterpriseMemberRecord {
  return {
    id: memberId,
    tenantId,
    userId,
    role: "member",
    status: "active",
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}
function auditRecord(): EnterpriseAuditEventRecord {
  return {
    id: auditId,
    tenantId,
    actorUserId: ownerId,
    action: "member.update",
    resourceType: "member",
    resourceId: memberId,
    result: "completed",
    details: { role: "member", version: 1 },
    traceId: "trace-a",
    createdAt: now,
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
    created_at: now,
    updated_at: now,
    version: "3",
    ...overrides,
  };
}
function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: memberId,
    tenant_id: tenantId,
    user_id: userId,
    role: "member",
    status: "active",
    joined_at: now,
    created_at: now,
    updated_at: now,
    version: "1",
    ...overrides,
  };
}
function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: auditId,
    tenant_id: tenantId,
    actor_id: ownerId,
    action: "member.update",
    resource_type: "member",
    resource_id: memberId,
    result: "completed",
    details: { role: "member", version: 1 },
    trace_id: "trace-a",
    created_at: now,
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
