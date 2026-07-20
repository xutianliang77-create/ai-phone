import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export interface EnterpriseDataLifecycleJob {
  id: string;
  tenantId: string;
  jobType: "object.delete";
  dataClass: "audit_export";
  sourceId: string;
  objectKey: string;
  objectSha256: string;
  sizeBytes: number;
  retentionDays: number;
  retentionUntil: string;
  status: "processing" | "completed" | "failed";
  attempts: number;
  nextAttemptAt?: string;
  leaseExpiresAt?: string;
  completionOutcome?: "deleted" | "already_absent";
  receiptHash?: string;
  errorCode?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type EnterpriseDataLifecycleFinalization =
  | { status: "completed"; outcome: "deleted" | "already_absent";
      receiptHash: string }
  | { status: "retry"; errorCode: string; nextAttemptAt: string }
  | { status: "failed"; errorCode: string };

interface DataLifecycleRow extends Record<string, unknown> {
  id: unknown; tenant_id: unknown; job_type: unknown; data_class: unknown;
  source_id: unknown; object_key: unknown; object_sha256: unknown;
  size_bytes: unknown; retention_days: unknown; retention_until: unknown;
  status: unknown; attempts: unknown; next_attempt_at: unknown;
  lease_expires_at: unknown; completion_outcome: unknown;
  receipt_hash: unknown; error_code: unknown; completed_at: unknown;
  created_at: unknown; updated_at: unknown;
}

const columns = `id, tenant_id, job_type, data_class, source_id, object_key,
  object_sha256, size_bytes, retention_days, retention_until, status, attempts,
  next_attempt_at, lease_expires_at, completion_outcome, receipt_hash,
  error_code, completed_at, created_at, updated_at`;

export class EnterpriseDataLifecyclePostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async claim(input: {
    id: string;
    now: string;
    leaseExpiresAt: string;
    expedite: boolean;
  }) {
    const result = await this.session.query<DataLifecycleRow>(`
      UPDATE enterprise.data_lifecycle_jobs SET
        attempts = attempts + 1, lease_expires_at = $3, updated_at = $2
      WHERE tenant_id = $1 AND id = $4 AND status = 'processing'
        AND (retention_until <= $2 OR $5::boolean)
        AND COALESCE(next_attempt_at, '-infinity'::timestamptz) <= $2
        AND COALESCE(lease_expires_at, '-infinity'::timestamptz) <= $2
      RETURNING ${columns}
    `, [input.now, input.leaseExpiresAt, input.id, input.expedite]);
    return result.rows[0]
      ? { status: "claimed" as const,
          job: mapDataLifecycleJob(result.rows[0], this.session.context.tenantId) }
      : { status: "busy" as const };
  }

  async finalize(input: {
    id: string;
    attempt: number;
    now: string;
    result: EnterpriseDataLifecycleFinalization;
  }) {
    const fields = input.result.status === "completed"
      ? `status = 'completed', completion_outcome = $5, receipt_hash = $6,
          error_code = NULL, completed_at = $4, lease_expires_at = NULL,
          next_attempt_at = NULL`
      : input.result.status === "failed"
      ? `status = 'failed', error_code = $5, completed_at = $4,
          lease_expires_at = NULL, next_attempt_at = NULL`
      : `error_code = $5, lease_expires_at = NULL, next_attempt_at = $6`;
    const values = input.result.status === "completed"
      ? [input.id, input.attempt, input.now, input.result.outcome,
          input.result.receiptHash]
      : input.result.status === "failed"
      ? [input.id, input.attempt, input.now, input.result.errorCode]
      : [input.id, input.attempt, input.now, input.result.errorCode,
          input.result.nextAttemptAt];
    const result = await this.session.query<DataLifecycleRow>(`
      UPDATE enterprise.data_lifecycle_jobs SET ${fields}, updated_at = $4
      WHERE tenant_id = $1 AND id = $2 AND attempts = $3
        AND status = 'processing' RETURNING ${columns}
    `, values);
    return result.rows[0]
      ? { status: "updated" as const,
          job: mapDataLifecycleJob(result.rows[0], this.session.context.tenantId) }
      : { status: "conflict" as const };
  }

  async outstandingCount() {
    const result = await this.session.query<{ count: unknown }>(`
      SELECT (
        (SELECT count(*) FROM enterprise.data_lifecycle_jobs
          WHERE tenant_id = $1 AND status <> 'completed') +
        (SELECT count(*) FROM enterprise.audit_export_jobs
          WHERE tenant_id = $1 AND status = 'processing')
      )::text AS count
    `);
    const count = Number(result.rows[0]?.count);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("Invalid enterprise data lifecycle count");
    }
    return count;
  }
}

function mapDataLifecycleJob(
  row: DataLifecycleRow,
  tenantId: string,
): EnterpriseDataLifecycleJob {
  const rowTenantId = text(row.tenant_id);
  const status = text(row.status);
  if (rowTenantId !== tenantId || row.job_type !== "object.delete" ||
    row.data_class !== "audit_export" ||
    !["processing", "completed", "failed"].includes(status)) {
    throw new Error("Invalid enterprise data lifecycle row");
  }
  const completionOutcome = optionalText(row.completion_outcome);
  if (completionOutcome !== undefined &&
    completionOutcome !== "deleted" && completionOutcome !== "already_absent") {
    throw new Error("Invalid enterprise data lifecycle outcome");
  }
  return {
    id: text(row.id), tenantId: rowTenantId, jobType: "object.delete",
    dataClass: "audit_export", sourceId: text(row.source_id),
    objectKey: text(row.object_key), objectSha256: hash(row.object_sha256),
    sizeBytes: integer(row.size_bytes), retentionDays: integer(row.retention_days),
    retentionUntil: iso(row.retention_until),
    status: status as EnterpriseDataLifecycleJob["status"],
    attempts: integer(row.attempts),
    ...optional("nextAttemptAt", row.next_attempt_at, iso),
    ...optional("leaseExpiresAt", row.lease_expires_at, iso),
    ...(completionOutcome ? { completionOutcome } : {}),
    ...optional("receiptHash", row.receipt_hash, hash),
    ...optional("errorCode", row.error_code),
    ...optional("completedAt", row.completed_at, iso),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function optional(key: string, value: unknown, map = text) {
  return value == null ? {} : { [key]: map(value) };
}
function optionalText(value: unknown) {
  return value == null ? undefined : text(value);
}
function text(value: unknown) {
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid enterprise data lifecycle text");
  }
  return value;
}
function hash(value: unknown) {
  const result = text(value);
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new Error("Invalid enterprise data lifecycle hash");
  }
  return result;
}
function integer(value: unknown) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Invalid enterprise data lifecycle integer");
  }
  return result;
}
function iso(value: unknown) {
  const result = value instanceof Date ? value.toISOString() : text(value);
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error("Invalid enterprise data lifecycle timestamp");
  }
  return result;
}
