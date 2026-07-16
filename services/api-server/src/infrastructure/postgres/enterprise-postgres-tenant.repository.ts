import {
  type EnterpriseAuditResult,
  type EnterpriseMemberRole,
  type EnterpriseMemberStatus,
} from "@translation/contracts";
import type {
  EnterpriseAuditEventRecord,
  EnterpriseMemberRecord,
  EnterpriseTenantRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";
import type {
  EnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import {
  withEnterpriseTenantPostgresSession,
  type EnterpriseTenantPostgresPool,
  type EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  mapEnterpriseAuditRow,
  mapEnterpriseMemberRow,
  mapEnterpriseTenantRow,
  type EnterpriseAuditPostgresRow,
  type EnterpriseMemberPostgresRow,
  type EnterpriseTenantPostgresRow,
} from "./enterprise-postgres-row-mappers.js";

export interface EnterprisePostgresAuditPosition {
  createdAt: string;
  id: string;
}

export interface EnterpriseTenantPostgresRepository {
  findTenant(options?: {
    lock?: boolean;
  }): Promise<EnterpriseTenantRecord | null>;
  listMembers(): Promise<EnterpriseMemberRecord[]>;
  findMemberByUserId(userId: string): Promise<EnterpriseMemberRecord | null>;
  insertMember(member: EnterpriseMemberRecord): Promise<
    | { status: "created"; member: EnterpriseMemberRecord }
    | { status: "already_exists" }
  >;
  updateMember(input: {
    memberId: string;
    expectedVersion: number;
    role?: EnterpriseMemberRole;
    status?: EnterpriseMemberStatus;
    updatedAt: string;
  }): Promise<
    | { status: "updated"; member: EnterpriseMemberRecord }
    | { status: "not_found" }
    | { status: "owner_protected"; member: EnterpriseMemberRecord }
    | { status: "conflict" }
  >;
  appendAuditEvent(event: EnterpriseAuditEventRecord): Promise<void>;
  listAuditEvents(input: {
    limit: number;
    action?: string;
    resourceType?: string;
    result?: EnterpriseAuditResult;
    before?: EnterprisePostgresAuditPosition;
  }): Promise<{
    events: EnterpriseAuditEventRecord[];
    nextPosition?: EnterprisePostgresAuditPosition;
  }>;
}

export function withEnterpriseTenantPostgresRepository<T>(
  pool: EnterpriseTenantPostgresPool,
  context: EnterpriseTenantContext,
  operation: (repository: EnterpriseTenantPostgresRepository) => Promise<T>,
) {
  return withEnterpriseTenantPostgresSession(
    pool,
    context,
    (session) => operation(createEnterpriseTenantPostgresRepository(session)),
  );
}

export function createEnterpriseTenantPostgresRepository(
  session: EnterpriseTenantPostgresSession,
): EnterpriseTenantPostgresRepository {
  return new PostgresTenantRepository(session);
}

class PostgresTenantRepository implements EnterpriseTenantPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async findTenant(options: { lock?: boolean } = {}) {
    const result = await this.session.queryTenantRecord<
      EnterpriseTenantPostgresRow
    >(`
      SELECT id, name, status, home_region, cell_id, plan_code,
        trial_ends_at, billing_customer_ref, data_retention_days,
        created_at, updated_at, version
      FROM enterprise.tenants
      WHERE id = $1
      ${options.lock ? "FOR UPDATE" : ""}
    `);
    return result.rows[0]
      ? mapEnterpriseTenantRow(result.rows[0], this.session.context.tenantId)
      : null;
  }

  async listMembers() {
    const result = await this.session.query<EnterpriseMemberPostgresRow>(`
      SELECT id, tenant_id, user_id, role, status, joined_at,
        created_at, updated_at, version
      FROM enterprise.members
      WHERE tenant_id = $1
      ORDER BY created_at, id
    `);
    return result.rows.map((row) =>
      mapEnterpriseMemberRow(row, this.session.context.tenantId)
    );
  }

  async findMemberByUserId(userId: string) {
    const result = await this.session.query<EnterpriseMemberPostgresRow>(`
      SELECT id, tenant_id, user_id, role, status, joined_at,
        created_at, updated_at, version
      FROM enterprise.members
      WHERE tenant_id = $1 AND user_id = $2
    `, [userId]);
    if (!result.rows[0]) return null;
    const member = mapEnterpriseMemberRow(
      result.rows[0],
      this.session.context.tenantId,
    );
    if (member.userId !== userId) {
      throw new Error("Enterprise PostgreSQL member user mismatch");
    }
    return member;
  }

  async insertMember(member: EnterpriseMemberRecord) {
    assertTenantMatch(member.tenantId, this.session.context.tenantId);
    const result = await this.session.query<EnterpriseMemberPostgresRow>(`
      INSERT INTO enterprise.members(
        tenant_id, id, user_id, role, status, joined_at,
        created_at, updated_at, version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (tenant_id, user_id) DO NOTHING
      RETURNING id, tenant_id, user_id, role, status, joined_at,
        created_at, updated_at, version
    `, [
      member.id,
      member.userId,
      member.role,
      member.status,
      member.joinedAt ?? null,
      member.createdAt,
      member.updatedAt,
      member.version,
    ]);
    if (!result.rows[0]) {
      const existing = await this.findMemberByUserId(member.userId);
      if (existing) await this.upsertDirectory(existing);
      return { status: "already_exists" as const };
    }
    const created = mapEnterpriseMemberRow(
      result.rows[0],
      this.session.context.tenantId,
    );
    await this.upsertDirectory(created);
    return { status: "created" as const, member: created };
  }

  async updateMember(input: {
    memberId: string;
    expectedVersion: number;
    role?: EnterpriseMemberRole;
    status?: EnterpriseMemberStatus;
    updatedAt: string;
  }) {
    if (input.role === undefined && input.status === undefined) {
      throw new Error("Enterprise member update is empty");
    }
    const currentResult = await this.session.query<
      EnterpriseMemberPostgresRow
    >(`
      SELECT id, tenant_id, user_id, role, status, joined_at,
        created_at, updated_at, version
      FROM enterprise.members
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE
    `, [input.memberId]);
    if (!currentResult.rows[0]) return { status: "not_found" as const };
    const current = mapEnterpriseMemberRow(
      currentResult.rows[0],
      this.session.context.tenantId,
    );
    if (current.role === "owner") {
      return { status: "owner_protected" as const, member: current };
    }
    if (current.version !== input.expectedVersion) {
      return { status: "conflict" as const };
    }
    const result = await this.session.query<EnterpriseMemberPostgresRow>(`
      UPDATE enterprise.members
      SET role = COALESCE($2::text, role),
        status = COALESCE($3::text, status),
        updated_at = $4,
        version = version + 1
      WHERE tenant_id = $1 AND id = $5 AND version = $6
      RETURNING id, tenant_id, user_id, role, status, joined_at,
        created_at, updated_at, version
    `, [
      input.role ?? null,
      input.status ?? null,
      input.updatedAt,
      input.memberId,
      input.expectedVersion,
    ]);
    if (!result.rows[0]) return { status: "conflict" as const };
    const updated = mapEnterpriseMemberRow(
      result.rows[0],
      this.session.context.tenantId,
    );
    await this.upsertDirectory(updated);
    return { status: "updated" as const, member: updated };
  }

  async appendAuditEvent(event: EnterpriseAuditEventRecord) {
    assertTenantMatch(event.tenantId, this.session.context.tenantId);
    await this.session.query(`
      INSERT INTO enterprise.audit_events(
        tenant_id, id, actor_id, action, resource_type, resource_id,
        result, details, trace_id, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      event.id,
      event.actorUserId ?? null,
      event.action,
      event.resourceType,
      event.resourceId ?? null,
      event.result,
      event.details,
      event.traceId,
      event.createdAt,
    ]);
  }

  async listAuditEvents(input: {
    limit: number;
    action?: string;
    resourceType?: string;
    result?: EnterpriseAuditResult;
    before?: EnterprisePostgresAuditPosition;
  }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error("Invalid enterprise audit limit");
    }
    const values: unknown[] = [];
    const conditions = ["tenant_id = $1"];
    if (input.action) {
      conditions.push(`action = ${parameter(values, input.action)}`);
    }
    if (input.resourceType) {
      conditions.push(
        `resource_type = ${parameter(values, input.resourceType)}`,
      );
    }
    if (input.result) {
      conditions.push(`result = ${parameter(values, input.result)}`);
    }
    if (input.before) {
      const createdAt = parameter(values, input.before.createdAt);
      const id = parameter(values, input.before.id);
      conditions.push(
        `(created_at < ${createdAt} OR (created_at = ${createdAt} AND id < ${id}))`,
      );
    }
    const limit = parameter(values, input.limit + 1);
    const result = await this.session.query<EnterpriseAuditPostgresRow>(`
      SELECT id, tenant_id, actor_id, action, resource_type, resource_id,
        result, details, trace_id, created_at
      FROM enterprise.audit_events
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `, values);
    const matching = result.rows.map((row) =>
      mapEnterpriseAuditRow(row, this.session.context.tenantId)
    );
    const hasMore = matching.length > input.limit;
    const events = matching.slice(0, input.limit);
    const last = events.at(-1);
    return {
      events,
      nextPosition: hasMore && last
        ? { createdAt: last.createdAt, id: last.id }
        : undefined,
    };
  }

  private async upsertDirectory(member: EnterpriseMemberRecord) {
    await this.session.query(`
      INSERT INTO enterprise.user_tenant_directory(
        tenant_id, user_id, member_id, member_status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, tenant_id) DO UPDATE SET
        member_id = excluded.member_id,
        member_status = excluded.member_status,
        updated_at = excluded.updated_at
      WHERE enterprise.user_tenant_directory.tenant_id = $1
    `, [
      member.userId,
      member.id,
      member.status,
      member.createdAt,
      member.updatedAt,
    ]);
  }
}

function parameter(values: unknown[], value: unknown) {
  values.push(value);
  return `$${values.length + 1}`;
}

function assertTenantMatch(value: string, tenantId: string) {
  if (value !== tenantId) {
    throw new Error("Enterprise PostgreSQL row tenant mismatch");
  }
}
