import {
  enterprisePostgresAccountSubjectId,
  enterprisePostgresActorSubjectId,
} from "./enterprise-postgres-subject-id.js";
import type {
  EnterpriseDataSnapshot,
} from "./enterprise-postgres-data-manifest.js";
import type {
  PostgresMigrationClient,
} from "./enterprise-postgres-migrations.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function writeEnterprisePostgresData(
  client: PostgresMigrationClient,
  snapshot: EnterpriseDataSnapshot,
) {
  assertEnterpriseDataRelationships(snapshot);
  for (const tenant of snapshot.enterpriseTenants) {
    await client.query(`
      INSERT INTO enterprise.tenants(
        id, name, status, home_region, cell_id, plan_code, trial_ends_at,
        billing_customer_ref, data_retention_days, created_at, updated_at,
        version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      tenant.id, tenant.name, tenant.status, tenant.homeRegion,
      tenant.cellId ?? null, tenant.planCode, tenant.trialEndsAt ?? null,
      tenant.billingCustomerRef ?? null, tenant.dataRetentionDays,
      tenant.createdAt, tenant.updatedAt, tenant.version,
    ]);
  }
  for (const member of snapshot.enterpriseMembers) {
    await client.query(`
      INSERT INTO enterprise.members(
        id, tenant_id, user_id, role, status, joined_at,
        created_at, updated_at, version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      member.id, member.tenantId, member.userId, member.role, member.status,
      member.joinedAt ?? null, member.createdAt, member.updatedAt,
      member.version,
    ]);
  }
  for (const job of snapshot.enterpriseTenantJobs) {
    await client.query(`
      INSERT INTO enterprise.tenant_jobs(
        id, tenant_id, actor_id, job_type, idempotency_key, request_hash,
        status, attempts, error_code, lease_expires_at, next_attempt_at,
        scope_snapshot, receipt_ref, receipt_hash, completed_at,
        created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17
      )
    `, [
      job.id, job.tenantId, job.actorUserId, job.type, job.idempotencyKey,
      job.requestHash, job.status, job.attempts, job.errorCode ?? null,
      job.leaseExpiresAt ?? null, job.nextAttemptAt ?? null,
      job.scopeSnapshot ? JSON.stringify(job.scopeSnapshot) : null,
      job.receiptRef ?? null, job.receiptHash ?? null,
      job.completedAt ?? null, job.createdAt, job.updatedAt,
    ]);
  }
  for (const event of snapshot.enterpriseAuditEvents) {
    await client.query(`
      INSERT INTO enterprise.audit_events(
        id, tenant_id, actor_id, action, resource_type, resource_id,
        result, details, trace_id, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      event.id, event.tenantId, event.actorUserId ?? null, event.action,
      event.resourceType, event.resourceId ?? null, event.result,
      JSON.stringify(event.details), event.traceId, event.createdAt,
    ]);
  }
  for (const event of snapshot.enterpriseInboxEvents) {
    await client.query(`
      INSERT INTO enterprise.inbox_events(
        id, tenant_id, source, source_event_id, event_type, payload_hash,
        payload, trace_id, received_at, processed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      event.id, event.tenantId, event.source, event.sourceEventId,
      event.eventType, event.payloadHash, JSON.stringify(event.payload),
      event.traceId, event.receivedAt, event.processedAt,
    ]);
  }
  for (const event of snapshot.enterpriseOutboxEvents) {
    await client.query(`
      INSERT INTO enterprise.outbox_events(
        id, tenant_id, aggregate_type, aggregate_id, event_type,
        idempotency_key, payload, trace_id, attempts, available_at,
        lease_expires_at, last_error_code, created_at, published_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      )
    `, [
      event.id, event.tenantId, event.aggregateType, event.aggregateId,
      event.eventType, event.idempotencyKey, JSON.stringify(event.payload),
      event.traceId, event.attempts, event.availableAt,
      event.leaseExpiresAt ?? null, event.lastErrorCode ?? null,
      event.createdAt, event.publishedAt ?? null,
    ]);
  }
}

function assertEnterpriseDataRelationships(snapshot: EnterpriseDataSnapshot) {
  const tenants = new Set(snapshot.enterpriseTenants.map(({ id }) => uuid(id)));
  assertUnique(tenants.size, snapshot.enterpriseTenants.length, "tenant");
  for (const tenant of snapshot.enterpriseTenants) {
    uuid(tenant.id);
  }
  for (const member of snapshot.enterpriseMembers) {
    assertTenant(tenants, member.tenantId);
    uuid(member.id);
    enterprisePostgresAccountSubjectId(member.userId);
  }
  for (const job of snapshot.enterpriseTenantJobs) {
    assertTenant(tenants, job.tenantId);
    uuid(job.id);
    enterprisePostgresAccountSubjectId(job.actorUserId);
  }
  for (const event of snapshot.enterpriseAuditEvents) {
    assertTenant(tenants, event.tenantId);
    uuid(event.id);
    if (event.actorUserId) enterprisePostgresActorSubjectId(event.actorUserId);
    if (event.resourceId) uuid(event.resourceId);
  }
  for (const event of snapshot.enterpriseInboxEvents) {
    assertTenant(tenants, event.tenantId);
    uuid(event.id);
  }
  for (const event of snapshot.enterpriseOutboxEvents) {
    assertTenant(tenants, event.tenantId);
    uuid(event.id);
    uuid(event.aggregateId);
  }
}

function assertTenant(tenants: Set<string>, tenantId: string) {
  if (!tenants.has(uuid(tenantId))) {
    throw new Error(`Enterprise data references missing tenant: ${tenantId}`);
  }
}

function assertUnique(actual: number, expected: number, label: string) {
  if (actual !== expected) {
    throw new Error(`Enterprise data has duplicate ${label} IDs`);
  }
}

function uuid(value: string) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error(`Invalid enterprise data UUID: ${String(value)}`);
  }
  return value;
}
