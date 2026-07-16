import type {
  PostgresMigrationClient,
} from "./enterprise-postgres-migrations.js";
import {
  mapEnterpriseInboxRow,
  mapEnterpriseOutboxRow,
  type EnterpriseInboxPostgresRow,
  type EnterpriseOutboxPostgresRow,
} from "./enterprise-postgres-event-row-mappers.js";
import {
  mapEnterpriseAuditRow,
  mapEnterpriseMemberRow,
  mapEnterpriseTenantJobRow,
  mapEnterpriseTenantRow,
  type EnterpriseAuditPostgresRow,
  type EnterpriseMemberPostgresRow,
  type EnterpriseTenantJobPostgresRow,
  type EnterpriseTenantPostgresRow,
} from "./enterprise-postgres-row-mappers.js";
import type {
  EnterpriseDataSnapshot,
} from "./enterprise-postgres-data-manifest.js";

export async function readEnterprisePostgresData(
  client: PostgresMigrationClient,
): Promise<EnterpriseDataSnapshot> {
  const tenants = await client.query<EnterpriseTenantPostgresRow>(`
    SELECT id, name, status, home_region, cell_id, plan_code,
      trial_ends_at, billing_customer_ref, data_retention_days,
      created_at, updated_at, version
    FROM enterprise.tenants
    ORDER BY id
  `);
  const members = await client.query<EnterpriseMemberPostgresRow>(`
    SELECT id, tenant_id, user_id, role, status, joined_at,
      created_at, updated_at, version
    FROM enterprise.members
    ORDER BY tenant_id, id
  `);
  const jobs = await client.query<EnterpriseTenantJobPostgresRow>(`
    SELECT id, tenant_id, actor_id, job_type, idempotency_key, request_hash,
      status, attempts, error_code, lease_expires_at, next_attempt_at,
      scope_snapshot, receipt_ref, receipt_hash, completed_at,
      created_at, updated_at
    FROM enterprise.tenant_jobs
    ORDER BY tenant_id, id
  `);
  const audit = await client.query<EnterpriseAuditPostgresRow>(`
    SELECT id, tenant_id, actor_id, action, resource_type, resource_id,
      result, details, trace_id, created_at
    FROM enterprise.audit_events
    ORDER BY tenant_id, id
  `);
  const inbox = await client.query<EnterpriseInboxPostgresRow>(`
    SELECT id, tenant_id, source, source_event_id, event_type, payload_hash,
      payload, trace_id, received_at, processed_at
    FROM enterprise.inbox_events
    ORDER BY tenant_id, id
  `);
  const outbox = await client.query<EnterpriseOutboxPostgresRow>(`
    SELECT id, tenant_id, aggregate_type, aggregate_id, event_type,
      idempotency_key, payload, trace_id, attempts, available_at,
      lease_expires_at, last_error_code, created_at, published_at
    FROM enterprise.outbox_events
    ORDER BY tenant_id, id
  `);
  return {
    enterpriseTenants: tenants.rows.map((row) =>
      mapEnterpriseTenantRow(row, rowTenantId(row.id))
    ),
    enterpriseMembers: members.rows.map((row) =>
      mapEnterpriseMemberRow(row, rowTenantId(row.tenant_id))
    ),
    enterpriseTenantJobs: jobs.rows.map((row) =>
      mapEnterpriseTenantJobRow(row, rowTenantId(row.tenant_id))
    ),
    enterpriseAuditEvents: audit.rows.map((row) =>
      mapEnterpriseAuditRow(row, rowTenantId(row.tenant_id))
    ),
    enterpriseInboxEvents: inbox.rows.map((row) =>
      mapEnterpriseInboxRow(row, rowTenantId(row.tenant_id))
    ),
    enterpriseOutboxEvents: outbox.rows.map((row) =>
      mapEnterpriseOutboxRow(row, rowTenantId(row.tenant_id))
    ),
  };
}

function rowTenantId(value: unknown) {
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid enterprise PostgreSQL data tenant ID");
  }
  return value;
}
