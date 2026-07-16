import type {
  EnterpriseInboxEventRecord,
  EnterpriseOutboxEventRecord,
} from "../../modules/enterprise/enterprise-event-record.js";

export interface EnterpriseInboxPostgresRow extends Record<string, unknown> {
  id: unknown;
  tenant_id: unknown;
  source: unknown;
  source_event_id: unknown;
  event_type: unknown;
  payload_hash: unknown;
  payload: unknown;
  trace_id: unknown;
  received_at: unknown;
  processed_at: unknown;
}

export interface EnterpriseOutboxPostgresRow extends Record<string, unknown> {
  id: unknown;
  tenant_id: unknown;
  aggregate_type: unknown;
  aggregate_id: unknown;
  event_type: unknown;
  idempotency_key: unknown;
  payload: unknown;
  trace_id: unknown;
  attempts: unknown;
  available_at: unknown;
  lease_expires_at: unknown;
  last_error_code: unknown;
  created_at: unknown;
  published_at: unknown;
}

export function mapEnterpriseInboxRow(
  row: EnterpriseInboxPostgresRow,
  tenantId: string,
): EnterpriseInboxEventRecord {
  const rowTenantId = text(row.tenant_id);
  assertTenantMatch(rowTenantId, tenantId);
  return {
    id: text(row.id),
    tenantId: rowTenantId,
    source: text(row.source),
    sourceEventId: text(row.source_event_id),
    eventType: text(row.event_type),
    payloadHash: text(row.payload_hash),
    payload: jsonValue(row.payload),
    traceId: text(row.trace_id),
    receivedAt: iso(row.received_at),
    processedAt: iso(row.processed_at),
  };
}

export function mapEnterpriseOutboxRow(
  row: EnterpriseOutboxPostgresRow,
  tenantId: string,
): EnterpriseOutboxEventRecord {
  const rowTenantId = text(row.tenant_id);
  assertTenantMatch(rowTenantId, tenantId);
  const leaseExpiresAt = optionalIso(row.lease_expires_at);
  const lastErrorCode = optionalText(row.last_error_code);
  const publishedAt = optionalIso(row.published_at);
  return {
    id: text(row.id),
    tenantId: rowTenantId,
    aggregateType: text(row.aggregate_type),
    aggregateId: text(row.aggregate_id),
    eventType: text(row.event_type),
    idempotencyKey: text(row.idempotency_key),
    payload: jsonValue(row.payload),
    traceId: text(row.trace_id),
    attempts: nonNegativeInteger(row.attempts),
    availableAt: iso(row.available_at),
    ...(leaseExpiresAt ? { leaseExpiresAt } : {}),
    ...(lastErrorCode ? { lastErrorCode } : {}),
    createdAt: iso(row.created_at),
    ...(publishedAt ? { publishedAt } : {}),
  };
}

function assertTenantMatch(value: string, tenantId: string) {
  if (value !== tenantId) {
    throw new Error("Enterprise PostgreSQL row tenant mismatch");
  }
}

function text(value: unknown) {
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid enterprise PostgreSQL event text");
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
    throw new Error("Invalid enterprise PostgreSQL event timestamp");
  }
  return parsed.toISOString();
}

function optionalIso(value: unknown) {
  return value === null || value === undefined ? undefined : iso(value);
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Invalid enterprise PostgreSQL event attempts");
  }
  return parsed;
}

function jsonValue(value: unknown) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (parsed === undefined) {
    throw new Error("Invalid enterprise PostgreSQL event payload");
  }
  return structuredClone(parsed);
}
