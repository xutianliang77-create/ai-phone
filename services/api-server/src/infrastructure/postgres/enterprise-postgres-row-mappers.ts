import {
  isEnterpriseAuditResult,
  isEnterpriseMemberRole,
  isEnterpriseMemberStatus,
  type EnterpriseAuditDetailValue,
  type EnterpriseTenantJobStatus,
  type EnterpriseTenantJobType,
  type EnterpriseTenantStatus,
} from "@translation/contracts";
import type {
  EnterpriseAuditEventRecord,
  EnterpriseMemberRecord,
  EnterpriseTenantJobRecord,
  EnterpriseTenantLifecycleSnapshot,
  EnterpriseTenantRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";

export interface EnterpriseTenantPostgresRow extends Record<string, unknown> {
  id: unknown;
  name: unknown;
  status: unknown;
  home_region: unknown;
  cell_id: unknown;
  plan_code: unknown;
  trial_ends_at: unknown;
  billing_customer_ref: unknown;
  data_retention_days: unknown;
  created_at: unknown;
  updated_at: unknown;
  version: unknown;
}

export interface EnterpriseMemberPostgresRow extends Record<string, unknown> {
  id: unknown;
  tenant_id: unknown;
  user_id: unknown;
  role: unknown;
  status: unknown;
  joined_at: unknown;
  created_at: unknown;
  updated_at: unknown;
  version: unknown;
}

export interface EnterpriseAuditPostgresRow extends Record<string, unknown> {
  id: unknown;
  tenant_id: unknown;
  actor_id: unknown;
  action: unknown;
  resource_type: unknown;
  resource_id: unknown;
  result: unknown;
  details: unknown;
  trace_id: unknown;
  created_at: unknown;
}

export interface EnterpriseTenantJobPostgresRow
  extends Record<string, unknown> {
  id: unknown;
  tenant_id: unknown;
  actor_id: unknown;
  job_type: unknown;
  idempotency_key: unknown;
  request_hash: unknown;
  status: unknown;
  attempts: unknown;
  error_code: unknown;
  lease_expires_at: unknown;
  next_attempt_at: unknown;
  scope_snapshot: unknown;
  receipt_ref: unknown;
  receipt_hash: unknown;
  completed_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

const tenantStatuses = new Set<EnterpriseTenantStatus>([
  "provisioning",
  "provisioning_failed",
  "active",
  "suspended",
  "deletion_requested",
  "deleted",
]);
const tenantJobTypes = new Set<EnterpriseTenantJobType>([
  "tenant.provision",
  "tenant.suspend",
  "tenant.export",
  "tenant.delete",
]);
const tenantJobStatuses = new Set<EnterpriseTenantJobStatus>([
  "processing",
  "completed",
  "failed",
]);

export function mapEnterpriseTenantRow(
  row: EnterpriseTenantPostgresRow,
  tenantId: string,
): EnterpriseTenantRecord {
  const id = text(row.id);
  assertTenantMatch(id, tenantId);
  const status = text(row.status);
  if (!tenantStatuses.has(status as EnterpriseTenantStatus)) {
    throw new Error("Invalid enterprise tenant row status");
  }
  const cellId = optionalText(row.cell_id);
  const trialEndsAt = optionalIso(row.trial_ends_at);
  const billingCustomerRef = optionalText(row.billing_customer_ref);
  return {
    id,
    name: text(row.name),
    status: status as EnterpriseTenantStatus,
    homeRegion: text(row.home_region),
    ...(cellId ? { cellId } : {}),
    planCode: text(row.plan_code),
    ...(trialEndsAt ? { trialEndsAt } : {}),
    ...(billingCustomerRef ? { billingCustomerRef } : {}),
    dataRetentionDays: positiveInteger(row.data_retention_days),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    version: positiveInteger(row.version),
  };
}

export function mapEnterpriseMemberRow(
  row: EnterpriseMemberPostgresRow,
  tenantId: string,
): EnterpriseMemberRecord {
  const rowTenantId = text(row.tenant_id);
  assertTenantMatch(rowTenantId, tenantId);
  if (!isEnterpriseMemberRole(row.role)) {
    throw new Error("Invalid enterprise member row role");
  }
  if (!isEnterpriseMemberStatus(row.status)) {
    throw new Error("Invalid enterprise member row status");
  }
  const joinedAt = optionalIso(row.joined_at);
  return {
    id: text(row.id),
    tenantId: rowTenantId,
    userId: text(row.user_id),
    role: row.role,
    status: row.status,
    ...(joinedAt ? { joinedAt } : {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    version: positiveInteger(row.version),
  };
}

export function mapEnterpriseAuditRow(
  row: EnterpriseAuditPostgresRow,
  tenantId: string,
): EnterpriseAuditEventRecord {
  const rowTenantId = text(row.tenant_id);
  assertTenantMatch(rowTenantId, tenantId);
  if (!isEnterpriseAuditResult(row.result)) {
    throw new Error("Invalid enterprise audit row result");
  }
  const actorUserId = optionalText(row.actor_id);
  const resourceId = optionalText(row.resource_id);
  return {
    id: text(row.id),
    tenantId: rowTenantId,
    ...(actorUserId ? { actorUserId } : {}),
    action: text(row.action),
    resourceType: text(row.resource_type),
    ...(resourceId ? { resourceId } : {}),
    result: row.result,
    details: auditDetails(row.details),
    traceId: text(row.trace_id),
    createdAt: iso(row.created_at),
  };
}

export function mapEnterpriseTenantJobRow(
  row: EnterpriseTenantJobPostgresRow,
  tenantId: string,
): EnterpriseTenantJobRecord {
  const rowTenantId = text(row.tenant_id);
  assertTenantMatch(rowTenantId, tenantId);
  const type = text(row.job_type);
  const status = text(row.status);
  if (!tenantJobTypes.has(type as EnterpriseTenantJobType)) {
    throw new Error("Invalid enterprise tenant job type");
  }
  if (!tenantJobStatuses.has(status as EnterpriseTenantJobStatus)) {
    throw new Error("Invalid enterprise tenant job status");
  }
  const errorCode = optionalText(row.error_code);
  const leaseExpiresAt = optionalIso(row.lease_expires_at);
  const nextAttemptAt = optionalIso(row.next_attempt_at);
  const scopeSnapshot = optionalJsonObject<EnterpriseTenantLifecycleSnapshot>(
    row.scope_snapshot,
  );
  const receiptRef = optionalText(row.receipt_ref);
  const receiptHash = optionalText(row.receipt_hash);
  const completedAt = optionalIso(row.completed_at);
  return {
    id: text(row.id),
    tenantId: rowTenantId,
    actorUserId: text(row.actor_id),
    type: type as EnterpriseTenantJobType,
    idempotencyKey: text(row.idempotency_key),
    requestHash: text(row.request_hash),
    status: status as EnterpriseTenantJobStatus,
    attempts: nonNegativeInteger(row.attempts),
    ...(errorCode ? { errorCode } : {}),
    ...(leaseExpiresAt ? { leaseExpiresAt } : {}),
    ...(nextAttemptAt ? { nextAttemptAt } : {}),
    ...(scopeSnapshot ? { scopeSnapshot } : {}),
    ...(receiptRef ? { receiptRef } : {}),
    ...(receiptHash ? { receiptHash } : {}),
    ...(completedAt ? { completedAt } : {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function assertTenantMatch(value: string, tenantId: string) {
  if (value !== tenantId) {
    throw new Error("Enterprise PostgreSQL row tenant mismatch");
  }
}

function text(value: unknown) {
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid enterprise PostgreSQL text");
  }
  return value;
}

function optionalText(value: unknown) {
  return value === null || value === undefined ? undefined : text(value);
}

function iso(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  const parsed = typeof value === "string" ? new Date(value) : null;
  if (!parsed || !Number.isFinite(parsed.getTime())) {
    throw new Error("Invalid enterprise PostgreSQL timestamp");
  }
  return parsed.toISOString();
}

function optionalIso(value: unknown) {
  return value === null || value === undefined ? undefined : iso(value);
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("Invalid enterprise PostgreSQL positive integer");
  }
  return parsed;
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Invalid enterprise PostgreSQL non-negative integer");
  }
  return parsed;
}

function optionalJsonObject<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid enterprise PostgreSQL JSON object");
  }
  return structuredClone(parsed) as T;
}

function auditDetails(value: unknown) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid enterprise audit details");
  }
  return Object.fromEntries(Object.entries(
    parsed as Record<string, unknown>,
  ).map(([key, item]) => {
    if (
      item !== null &&
      typeof item !== "string" &&
      typeof item !== "number" &&
      typeof item !== "boolean"
    ) {
      throw new Error("Invalid enterprise audit detail value");
    }
    return [key, item as EnterpriseAuditDetailValue];
  }));
}
