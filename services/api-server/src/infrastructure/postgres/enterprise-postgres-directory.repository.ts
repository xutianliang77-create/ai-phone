import {
  withEnterpriseDirectoryPostgresSession,
} from "./enterprise-postgres-directory-session.js";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import {
  withEnterpriseTenantPostgresRepository,
} from "./enterprise-postgres-tenant.repository.js";
import type {
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";
import {
  enterprisePostgresAccountSubjectId,
} from "./enterprise-postgres-subject-id.js";

interface DirectoryRow extends Record<string, unknown> {
  user_id: unknown;
  tenant_id: unknown;
  member_id: unknown;
  member_status: unknown;
}

export function listActiveEnterpriseMembershipRefs(
  pool: EnterpriseTenantPostgresPool,
  userId: string,
) {
  return withEnterpriseDirectoryPostgresSession(
    pool,
    userId,
    async (session) => {
      const result = await session.query<DirectoryRow>(`
        SELECT user_id, tenant_id, member_id, member_status
        FROM enterprise.user_tenant_directory
        WHERE user_id = $1 AND member_status = 'active'
        ORDER BY tenant_id
        LIMIT 101
      `);
      if (result.rows.length > 100) {
        throw new Error("Enterprise directory membership limit exceeded");
      }
      return result.rows.map((row) => {
        const rowUserId = enterprisePostgresAccountSubjectId(row.user_id);
        if (rowUserId !== session.userId || row.member_status !== "active") {
          throw new Error("Invalid enterprise directory row");
        }
        return {
          tenantId: requiredText(row.tenant_id),
          memberId: requiredText(row.member_id),
        };
      });
    },
  );
}

export async function listEnterprisePostgresMemberships(input: {
  pool: EnterpriseTenantPostgresPool;
  userId: string;
  traceId: string;
}) {
  const refs = await listActiveEnterpriseMembershipRefs(
    input.pool,
    input.userId,
  );
  const memberships = [];
  for (const ref of refs) {
    const membership = await loadMembership(input, ref);
    if (membership) memberships.push(membership);
  }
  return memberships;
}

export async function resolveEnterprisePostgresContext(input: {
  pool: EnterpriseTenantPostgresPool;
  userId: string;
  selectedTenantId?: string;
  traceId: string;
}) {
  const refs = await listActiveEnterpriseMembershipRefs(
    input.pool,
    input.userId,
  );
  if (input.selectedTenantId) {
    const ref = refs.find(({ tenantId }) =>
      tenantId === input.selectedTenantId
    );
    if (!ref) return { status: "access_denied" as const };
    const membership = await loadMembership(input, ref);
    return membership
      ? { status: "resolved" as const, ...membership }
      : { status: "access_denied" as const };
  }
  const memberships = [];
  for (const ref of refs) {
    const membership = await loadMembership(input, ref);
    if (membership) memberships.push(membership);
  }
  if (memberships.length === 0) return { status: "access_denied" as const };
  if (memberships.length > 1) {
    return { status: "selection_required" as const };
  }
  return { status: "resolved" as const, ...memberships[0]! };
}

async function loadMembership(
  input: {
    pool: EnterpriseTenantPostgresPool;
    userId: string;
    traceId: string;
  },
  ref: { tenantId: string; memberId: string },
) {
  return withEnterpriseTenantPostgresRepository(
    input.pool,
    createEnterpriseTenantContext({
      tenantId: ref.tenantId,
      actorUserId: input.userId,
      traceId: input.traceId,
    }),
    async (repository) => {
      const tenant = await repository.findTenant();
      const member = await repository.findMemberByUserId(input.userId);
      if (!tenant || !member) return null;
      if (member.id !== ref.memberId) {
        throw new Error("Enterprise directory membership mismatch");
      }
      return tenant.status === "active" && member.status === "active"
        ? { tenant, member }
        : null;
    },
  );
}

function requiredText(value: unknown) {
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid enterprise directory row");
  }
  return value;
}
