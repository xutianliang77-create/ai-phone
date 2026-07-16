import type {
  EnterpriseTenantStatus,
} from "@translation/contracts";
import type {
  EnterpriseMemberRecord,
  EnterpriseTenantJobRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";
import type {
  EnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import {
  mapEnterpriseMemberRow,
  mapEnterpriseTenantJobRow,
  mapEnterpriseTenantRow,
  type EnterpriseMemberPostgresRow,
  type EnterpriseTenantJobPostgresRow,
  type EnterpriseTenantPostgresRow,
} from "./enterprise-postgres-row-mappers.js";
import {
  withEnterpriseTenantPostgresSession,
  type EnterpriseTenantPostgresPool,
  type EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  enterprisePostgresAccountSubjectId,
} from "./enterprise-postgres-subject-id.js";
import {
  findEnterpriseLifecycleJob,
  findEnterpriseLifecycleJobByIdempotency,
  hasEnterpriseProcessingJob,
  listEnterpriseLifecycleJobs,
} from "./enterprise-postgres-lifecycle-queries.js";
import type {
  EnterpriseLifecyclePostgresRepository,
} from "./enterprise-postgres-lifecycle-repository-types.js";
export type {
  EnterpriseLifecyclePostgresRepository,
} from "./enterprise-postgres-lifecycle-repository-types.js";

export function withEnterpriseLifecyclePostgresRepository<T>(
  pool: EnterpriseTenantPostgresPool,
  context: EnterpriseTenantContext,
  operation: (repository: EnterpriseLifecyclePostgresRepository) => Promise<T>,
) {
  return withEnterpriseTenantPostgresSession(
    pool,
    context,
    (session) =>
      operation(createEnterpriseLifecyclePostgresRepository(session)),
  );
}

export function createEnterpriseLifecyclePostgresRepository(
  session: EnterpriseTenantPostgresSession,
): EnterpriseLifecyclePostgresRepository {
  return new PostgresLifecycleRepository(session);
}

class PostgresLifecycleRepository
  implements EnterpriseLifecyclePostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async insertJob(job: EnterpriseTenantJobRecord) {
    this.assertJobScope(job);
    const result = await this.session.query<EnterpriseTenantJobPostgresRow>(`
      INSERT INTO enterprise.tenant_jobs(
        tenant_id, id, actor_id, job_type, idempotency_key, request_hash,
        status, attempts, error_code, lease_expires_at, next_attempt_at,
        scope_snapshot, receipt_ref, receipt_hash, completed_at,
        created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17
      )
      ON CONFLICT (actor_id, job_type, idempotency_key) DO NOTHING
      RETURNING *
    `, jobValues(job));
    if (result.rows[0]) {
      return {
        status: "created" as const,
        job: mapEnterpriseTenantJobRow(
          result.rows[0],
          this.session.context.tenantId,
        ),
      };
    }
    const existing = await this.findJobByIdempotency(
      job.type,
      job.idempotencyKey,
    );
    if (!existing) {
      throw new Error("Enterprise lifecycle conflict row is missing");
    }
    return { status: "already_exists" as const, job: existing };
  }

  async findJob(jobId: string) {
    return findEnterpriseLifecycleJob(this.session, jobId);
  }

  async findJobByIdempotency(
    type: EnterpriseTenantJobRecord["type"],
    idempotencyKey: string,
  ) {
    return findEnterpriseLifecycleJobByIdempotency(
      this.session,
      type,
      idempotencyKey,
    );
  }

  async listJobs() {
    return listEnterpriseLifecycleJobs(this.session);
  }

  async hasProcessingJob(type: EnterpriseTenantJobRecord["type"]) {
    return hasEnterpriseProcessingJob(this.session, type);
  }

  async lockJob(jobId: string) {
    const actorUserId = this.accountActorUserId();
    const result = await this.session.query<EnterpriseTenantJobPostgresRow>(`
      SELECT *
      FROM enterprise.tenant_jobs
      WHERE tenant_id = $1 AND id = $2 AND actor_id = $3
      FOR UPDATE
    `, [jobId, actorUserId]);
    return result.rows[0]
      ? mapEnterpriseTenantJobRow(
          result.rows[0],
          this.session.context.tenantId,
        )
      : null;
  }

  async claimJob(input: {
    jobId: string;
    now: string;
    leaseExpiresAt: string;
    force?: boolean;
  }) {
    const actorUserId = this.accountActorUserId();
    const result = await this.session.query<EnterpriseTenantJobPostgresRow>(`
      UPDATE enterprise.tenant_jobs
      SET attempts = attempts + 1, lease_expires_at = $4,
        next_attempt_at = NULL, error_code = NULL, receipt_ref = NULL,
        receipt_hash = NULL, completed_at = NULL, updated_at = $3
      WHERE tenant_id = $1 AND id = $2 AND actor_id = $5
        AND status = 'processing'
        AND job_type IN ('tenant.export', 'tenant.delete')
        AND scope_snapshot IS NOT NULL
        AND COALESCE(lease_expires_at, '-infinity'::timestamptz) <= $3
        AND ($6 OR COALESCE(next_attempt_at, '-infinity'::timestamptz) <= $3)
      RETURNING *
    `, [
      input.jobId,
      input.now,
      input.leaseExpiresAt,
      actorUserId,
      input.force === true,
    ]);
    return result.rows[0]
      ? {
          status: "claimed" as const,
          job: mapEnterpriseTenantJobRow(
            result.rows[0],
            this.session.context.tenantId,
          ),
        }
      : { status: "busy" as const };
  }

  async listRecoverableJobs(input: { now: string; limit: number }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error("Invalid enterprise lifecycle recovery limit");
    }
    const result = await this.session.query<
      EnterpriseTenantJobPostgresRow
    >(`
      SELECT *
      FROM enterprise.tenant_jobs
      WHERE tenant_id = $1 AND status = 'processing'
        AND job_type IN ('tenant.export', 'tenant.delete')
        AND (lease_expires_at IS NULL OR lease_expires_at <= $2)
        AND (next_attempt_at IS NULL OR next_attempt_at <= $2)
      ORDER BY updated_at, id
      LIMIT $3
    `, [input.now, input.limit]);
    return result.rows.map((row) =>
      mapEnterpriseTenantJobRow(row, this.session.context.tenantId)
    );
  }

  async updateJob(input: {
    job: EnterpriseTenantJobRecord;
    expectedUpdatedAt: string;
  }) {
    this.assertJobScope(input.job);
    const job = input.job;
    const result = await this.session.query<EnterpriseTenantJobPostgresRow>(`
      UPDATE enterprise.tenant_jobs
      SET status = $2, attempts = $3, error_code = $4,
        lease_expires_at = $5, next_attempt_at = $6, scope_snapshot = $7,
        receipt_ref = $8, receipt_hash = $9, completed_at = $10,
        updated_at = $11
      WHERE tenant_id = $1 AND id = $12 AND actor_id = $13
        AND updated_at = $14
      RETURNING *
    `, [
      job.status,
      job.attempts,
      job.errorCode ?? null,
      job.leaseExpiresAt ?? null,
      job.nextAttemptAt ?? null,
      job.scopeSnapshot ?? null,
      job.receiptRef ?? null,
      job.receiptHash ?? null,
      job.completedAt ?? null,
      job.updatedAt,
      job.id,
      job.actorUserId,
      input.expectedUpdatedAt,
    ]);
    return result.rows[0]
      ? {
          status: "updated" as const,
          job: mapEnterpriseTenantJobRow(
            result.rows[0],
            this.session.context.tenantId,
          ),
        }
      : { status: "conflict" as const };
  }

  async updateTenantStatus(input: {
    status: EnterpriseTenantStatus;
    expectedVersion: number;
    updatedAt: string;
    cellId?: string;
  }) {
    const result = await this.session.queryTenantRecord<
      EnterpriseTenantPostgresRow
    >(`
      UPDATE enterprise.tenants
      SET status = $2, updated_at = $3,
        cell_id = COALESCE($4, cell_id),
        version = version + 1
      WHERE id = $1 AND version = $5
      RETURNING id, name, status, home_region, cell_id, plan_code,
        trial_ends_at, billing_customer_ref, data_retention_days,
        created_at, updated_at, version
    `, [
      input.status,
      input.updatedAt,
      input.cellId ?? null,
      input.expectedVersion,
    ]);
    return result.rows[0]
      ? {
          status: "updated" as const,
          tenant: mapEnterpriseTenantRow(
            result.rows[0],
            this.session.context.tenantId,
          ),
        }
      : { status: "conflict" as const };
  }

  async suspendMembers(updatedAt: string) {
    const result = await this.session.query<EnterpriseMemberPostgresRow>(`
      UPDATE enterprise.members
      SET status = 'suspended', updated_at = $2, version = version + 1
      WHERE tenant_id = $1 AND status <> 'suspended'
      RETURNING id, tenant_id, user_id, role, status, joined_at,
        created_at, updated_at, version
    `, [updatedAt]);
    await this.session.query(`
      UPDATE enterprise.user_tenant_directory
      SET member_status = 'suspended', updated_at = $2
      WHERE tenant_id = $1 AND member_status <> 'suspended'
    `, [updatedAt]);
    if (result.rows.length === 0) {
      return { status: "unchanged" as const, members: [] as [] };
    }
    return {
      status: "updated" as const,
      members: result.rows.map((row) =>
        mapEnterpriseMemberRow(row, this.session.context.tenantId)
      ),
    };
  }

  private assertJobScope(job: EnterpriseTenantJobRecord) {
    const actorUserId = this.accountActorUserId();
    enterprisePostgresAccountSubjectId(job.actorUserId);
    if (
      job.tenantId !== this.session.context.tenantId ||
      job.actorUserId !== actorUserId
    ) {
      throw new Error("Enterprise lifecycle job tenant or actor mismatch");
    }
  }

  private accountActorUserId() {
    return enterprisePostgresAccountSubjectId(
      this.session.context.actorUserId,
    );
  }
}

function jobValues(job: EnterpriseTenantJobRecord) {
  return [
    job.id,
    job.actorUserId,
    job.type,
    job.idempotencyKey,
    job.requestHash,
    job.status,
    job.attempts,
    job.errorCode ?? null,
    job.leaseExpiresAt ?? null,
    job.nextAttemptAt ?? null,
    job.scopeSnapshot ?? null,
    job.receiptRef ?? null,
    job.receiptHash ?? null,
    job.completedAt ?? null,
    job.createdAt,
    job.updatedAt,
  ];
}
