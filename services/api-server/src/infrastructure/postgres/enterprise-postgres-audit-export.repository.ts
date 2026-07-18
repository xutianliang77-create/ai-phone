import {
  isEnterpriseAuditExportPurpose,
  isEnterpriseAuditResult,
} from "@translation/contracts";
import type {
  EnterpriseAuditEventRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";
import type {
  EnterpriseAuditExportRecord,
} from "../../modules/enterprise/enterprise-audit-export.js";
import { mapEnterpriseAuditRow } from "./enterprise-postgres-row-mappers.js";
import { enterprisePostgresAccountSubjectId } from
  "./enterprise-postgres-subject-id.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

interface AuditExportRow extends Record<string, unknown> {
  id: unknown; tenant_id: unknown; actor_id: unknown; purpose: unknown;
  scope_from: unknown; scope_until: unknown; action_filter: unknown;
  resource_type_filter: unknown; result_filter: unknown; format: unknown;
  retention_days: unknown; idempotency_key: unknown; request_hash: unknown;
  status: unknown; attempts: unknown; next_attempt_at: unknown;
  lease_expires_at: unknown; object_key: unknown; event_count: unknown;
  size_bytes: unknown; artifact_sha256: unknown; expires_at: unknown;
  error_code: unknown; completed_at: unknown; created_at: unknown;
  updated_at: unknown;
}

const columns = `id, tenant_id, actor_id, purpose, scope_from, scope_until,
  action_filter, resource_type_filter, result_filter, format, retention_days,
  idempotency_key, request_hash, status, attempts, next_attempt_at,
  lease_expires_at, object_key, event_count, size_bytes, artifact_sha256,
  expires_at, error_code, completed_at, created_at, updated_at`;

export type EnterpriseAuditExportFinalization =
  | { status: "completed"; objectKey: string; eventCount: number;
      sizeBytes: number; sha256: string; expiresAt: string }
  | { status: "retry"; errorCode: string; nextAttemptAt: string }
  | { status: "failed"; errorCode: string };

export class EnterpriseAuditExportPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async create(input: {
    record: EnterpriseAuditExportRecord;
    artifactStoreReady: boolean;
  }) {
    const existing = await this.byIdempotencyKey(input.record.idempotencyKey, true);
    if (existing) return existing.requestHash === input.record.requestHash
      ? { status: "replayed" as const, auditExport: existing }
      : { status: "idempotency_conflict" as const };
    if (!input.artifactStoreReady) return { status: "artifact_store_required" as const };
    const record = input.record;
    const result = await this.session.query<AuditExportRow>(`
      INSERT INTO enterprise.audit_export_jobs(
        tenant_id, id, actor_id, purpose, scope_from, scope_until,
        action_filter, resource_type_filter, result_filter, format,
        retention_days, idempotency_key, request_hash, status, attempts,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        'processing', 0, $14, $14
      ) RETURNING ${columns}
    `, [
      record.id, enterprisePostgresAccountSubjectId(record.requestedBy),
      record.purpose, record.scope.from, record.scope.until,
      record.scope.action ?? null, record.scope.resourceType ?? null,
      record.scope.result ?? null, record.format, record.retentionDays,
      record.idempotencyKey, record.requestHash, record.createdAt,
    ]);
    return {
      status: "created" as const,
      auditExport: mapAuditExport(result.rows[0]!, this.session.context.tenantId),
    };
  }

  async list(limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Invalid audit export list limit");
    }
    const result = await this.session.query<AuditExportRow>(`
      SELECT ${columns} FROM enterprise.audit_export_jobs
      WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2
    `, [limit]);
    return result.rows.map((row) => mapAuditExport(row, this.session.context.tenantId));
  }

  async find(id: string, lock = false) {
    const result = await this.session.query<AuditExportRow>(`
      SELECT ${columns} FROM enterprise.audit_export_jobs
      WHERE tenant_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}
    `, [id]);
    return result.rows[0]
      ? mapAuditExport(result.rows[0], this.session.context.tenantId)
      : null;
  }

  async claim(input: { id: string; now: string; leaseExpiresAt: string }) {
    const result = await this.session.query<AuditExportRow>(`
      UPDATE enterprise.audit_export_jobs SET
        attempts = attempts + 1, lease_expires_at = $3, updated_at = $2
      WHERE tenant_id = $1 AND id = $4 AND status = 'processing'
        AND COALESCE(next_attempt_at, '-infinity'::timestamptz) <= $2
        AND COALESCE(lease_expires_at, '-infinity'::timestamptz) <= $2
      RETURNING ${columns}
    `, [input.now, input.leaseExpiresAt, input.id]);
    return result.rows[0]
      ? { status: "claimed" as const,
          auditExport: mapAuditExport(result.rows[0], this.session.context.tenantId) }
      : { status: "busy" as const };
  }

  async events(record: EnterpriseAuditExportRecord, maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 10_001) {
      throw new Error("Invalid audit export maximum");
    }
    const values: unknown[] = [record.scope.from, record.scope.until];
    const conditions = ["tenant_id = $1", "created_at >= $2", "created_at < $3"];
    addFilter(conditions, values, "action", record.scope.action);
    addFilter(conditions, values, "resource_type", record.scope.resourceType);
    addFilter(conditions, values, "result", record.scope.result);
    const limit = parameter(values, maximum);
    const result = await this.session.query<Record<string, unknown>>(`
      SELECT id, tenant_id, actor_id, action, resource_type, resource_id,
        result, details, trace_id, created_at
      FROM enterprise.audit_events WHERE ${conditions.join(" AND ")}
      ORDER BY created_at, id LIMIT ${limit}
    `, values);
    return result.rows.map((row) => mapEnterpriseAuditRow(
      row as Parameters<typeof mapEnterpriseAuditRow>[0],
      this.session.context.tenantId,
    )) as EnterpriseAuditEventRecord[];
  }

  async finalize(input: {
    id: string;
    attempt: number;
    now: string;
    result: EnterpriseAuditExportFinalization;
  }) {
    const fields = input.result.status === "completed"
      ? `status = 'completed', object_key = $5, event_count = $6,
          size_bytes = $7, artifact_sha256 = $8, expires_at = $9,
          completed_at = $4, lease_expires_at = NULL, next_attempt_at = NULL`
      : input.result.status === "failed"
      ? `status = 'failed', error_code = $5, completed_at = $4,
          lease_expires_at = NULL, next_attempt_at = NULL`
      : `error_code = NULL, lease_expires_at = NULL, next_attempt_at = $5`;
    const values = input.result.status === "completed"
      ? [input.id, input.attempt, input.now, input.result.objectKey,
          input.result.eventCount, input.result.sizeBytes, input.result.sha256,
          input.result.expiresAt]
      : input.result.status === "failed"
      ? [input.id, input.attempt, input.now, input.result.errorCode]
      : [input.id, input.attempt, input.now, input.result.nextAttemptAt];
    const result = await this.session.query<AuditExportRow>(`
      UPDATE enterprise.audit_export_jobs SET ${fields}, updated_at = $4
      WHERE tenant_id = $1 AND id = $2 AND attempts = $3
        AND status = 'processing' RETURNING ${columns}
    `, values);
    return result.rows[0]
      ? { status: "updated" as const,
          auditExport: mapAuditExport(result.rows[0], this.session.context.tenantId) }
      : { status: "conflict" as const };
  }

  private async byIdempotencyKey(key: string, lock: boolean) {
    const result = await this.session.query<AuditExportRow>(`
      SELECT ${columns} FROM enterprise.audit_export_jobs
      WHERE tenant_id = $1 AND idempotency_key = $2${lock ? " FOR UPDATE" : ""}
    `, [key]);
    return result.rows[0]
      ? mapAuditExport(result.rows[0], this.session.context.tenantId)
      : null;
  }
}

function addFilter(
  conditions: string[], values: unknown[], column: string, value?: string,
) {
  if (value === undefined) return;
  conditions.push(`${column} = ${parameter(values, value)}`);
}
function parameter(values: unknown[], value: unknown) {
  values.push(value);
  return `$${values.length + 1}`;
}

function mapAuditExport(row: AuditExportRow, tenantId: string): EnterpriseAuditExportRecord {
  const rowTenantId = text(row.tenant_id);
  if (rowTenantId !== tenantId || !isEnterpriseAuditExportPurpose(row.purpose) ||
    (row.result_filter != null && !isEnterpriseAuditResult(row.result_filter)) ||
    row.format !== "jsonl" || !["processing", "completed", "failed"].includes(text(row.status))) {
    throw new Error("Invalid enterprise audit export row");
  }
  return {
    id: text(row.id), tenantId: rowTenantId,
    requestedBy: enterprisePostgresAccountSubjectId(row.actor_id),
    purpose: row.purpose,
    scope: { from: iso(row.scope_from), until: iso(row.scope_until),
      ...optional("action", row.action_filter),
      ...optional("resourceType", row.resource_type_filter),
      ...(row.result_filter == null ? {} : { result: row.result_filter }) },
    format: "jsonl", retentionDays: integer(row.retention_days),
    idempotencyKey: text(row.idempotency_key), requestHash: text(row.request_hash),
    status: text(row.status) as EnterpriseAuditExportRecord["status"],
    attempts: integer(row.attempts),
    ...optional("nextAttemptAt", row.next_attempt_at, iso),
    ...optional("leaseExpiresAt", row.lease_expires_at, iso),
    ...optional("objectKey", row.object_key),
    ...(row.event_count == null ? {} : { eventCount: integer(row.event_count) }),
    ...(row.size_bytes == null ? {} : { sizeBytes: integer(row.size_bytes) }),
    ...optional("sha256", row.artifact_sha256),
    ...optional("expiresAt", row.expires_at, iso),
    ...optional("errorCode", row.error_code),
    ...optional("completedAt", row.completed_at, iso),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function optional(key: string, value: unknown, map = text) {
  return value == null ? {} : { [key]: map(value) };
}
function text(value: unknown) {
  if (typeof value !== "string" || !value) throw new Error("Invalid audit export text");
  return value;
}
function integer(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid audit export integer");
  return parsed;
}
function iso(value: unknown) {
  const result = value instanceof Date ? value.toISOString() : text(value);
  if (!Number.isFinite(Date.parse(result))) throw new Error("Invalid audit export timestamp");
  return result;
}
