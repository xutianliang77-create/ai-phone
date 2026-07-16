import type {
  EnterpriseTenantJobRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";
import {
  mapEnterpriseTenantJobRow,
  type EnterpriseTenantJobPostgresRow,
} from "./enterprise-postgres-row-mappers.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  enterprisePostgresAccountSubjectId,
} from "./enterprise-postgres-subject-id.js";

export async function findEnterpriseLifecycleJob(
  session: EnterpriseTenantPostgresSession,
  jobId: string,
) {
  const result = await session.query<EnterpriseTenantJobPostgresRow>(`
    SELECT *
    FROM enterprise.tenant_jobs
    WHERE tenant_id = $1 AND id = $2
  `, [jobId]);
  return result.rows[0]
    ? mapEnterpriseTenantJobRow(result.rows[0], session.context.tenantId)
    : null;
}

export async function findEnterpriseLifecycleJobByIdempotency(
  session: EnterpriseTenantPostgresSession,
  type: EnterpriseTenantJobRecord["type"],
  idempotencyKey: string,
) {
  const actorUserId = enterprisePostgresAccountSubjectId(
    session.context.actorUserId,
  );
  const result = await session.query<EnterpriseTenantJobPostgresRow>(`
    SELECT *
    FROM enterprise.tenant_jobs
    WHERE tenant_id = $1 AND actor_id = $2
      AND job_type = $3 AND idempotency_key = $4
  `, [actorUserId, type, idempotencyKey]);
  return result.rows[0]
    ? mapEnterpriseTenantJobRow(result.rows[0], session.context.tenantId)
    : null;
}

export async function listEnterpriseLifecycleJobs(
  session: EnterpriseTenantPostgresSession,
) {
  const result = await session.query<EnterpriseTenantJobPostgresRow>(`
    SELECT *
    FROM enterprise.tenant_jobs
    WHERE tenant_id = $1
    ORDER BY created_at, id
  `);
  return result.rows.map((row) =>
    mapEnterpriseTenantJobRow(row, session.context.tenantId)
  );
}

export async function hasEnterpriseProcessingJob(
  session: EnterpriseTenantPostgresSession,
  type: EnterpriseTenantJobRecord["type"],
) {
  const result = await session.query<{ present: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM enterprise.tenant_jobs
      WHERE tenant_id = $1 AND job_type = $2 AND status = 'processing'
    ) AS present
  `, [type]);
  return result.rows[0]?.present === true;
}
