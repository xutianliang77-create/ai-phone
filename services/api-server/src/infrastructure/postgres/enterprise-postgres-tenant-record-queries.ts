import type {
  EnterpriseMemberRecord,
  EnterpriseTenantRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";
import {
  mapEnterpriseMemberRow,
  mapEnterpriseTenantRow,
  type EnterpriseMemberPostgresRow,
  type EnterpriseTenantPostgresRow,
} from "./enterprise-postgres-row-mappers.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";

export async function insertEnterpriseTenantRecord(
  session: EnterpriseTenantPostgresSession,
  tenant: EnterpriseTenantRecord,
) {
  if (tenant.id !== session.context.tenantId) {
    throw new Error("Enterprise PostgreSQL row tenant mismatch");
  }
  const result = await session.queryTenantRecord<EnterpriseTenantPostgresRow>(`
    INSERT INTO enterprise.tenants(
      id, name, status, home_region, cell_id, plan_code, trial_ends_at,
      billing_customer_ref, data_retention_days, created_at, updated_at,
      version
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (id) DO NOTHING
    RETURNING id, name, status, home_region, cell_id, plan_code,
      trial_ends_at, billing_customer_ref, data_retention_days,
      created_at, updated_at, version
  `, [
    tenant.name,
    tenant.status,
    tenant.homeRegion,
    tenant.cellId ?? null,
    tenant.planCode,
    tenant.trialEndsAt ?? null,
    tenant.billingCustomerRef ?? null,
    tenant.dataRetentionDays,
    tenant.createdAt,
    tenant.updatedAt,
    tenant.version,
  ]);
  return result.rows[0]
    ? {
        status: "created" as const,
        tenant: mapEnterpriseTenantRow(
          result.rows[0],
          session.context.tenantId,
        ),
      }
    : { status: "already_exists" as const };
}

export async function findEnterpriseMemberById(
  session: EnterpriseTenantPostgresSession,
  memberId: string,
  options: { lock?: boolean } = {},
): Promise<EnterpriseMemberRecord | null> {
  const result = await session.query<EnterpriseMemberPostgresRow>(`
    SELECT id, tenant_id, user_id, role, status, joined_at,
      created_at, updated_at, version
    FROM enterprise.members
    WHERE tenant_id = $1 AND id = $2
    ${options.lock ? "FOR UPDATE" : ""}
  `, [memberId]);
  return result.rows[0]
    ? mapEnterpriseMemberRow(result.rows[0], session.context.tenantId)
    : null;
}
