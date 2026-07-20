import type { EnterpriseAuditExportArtifactStore } from
  "../../modules/enterprise/enterprise-audit-export-artifact-store.js";
import type { TenantLifecycleExecutionResult } from
  "../../modules/enterprise/enterprise-tenant-lifecycle-executor.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterpriseTenantJobRecord } from
  "../../modules/enterprise/enterprise-tenant-record.js";
import type { EnterprisePostgresPool } from "./enterprise-postgres-client.js";
import type { EnterpriseDataLifecycleJob } from
  "./enterprise-postgres-data-lifecycle.repository.js";
import { processEnterpriseDataLifecycleJob } from
  "./enterprise-postgres-data-lifecycle-worker.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

export function outstandingDataLifecycleJobs(input: {
  pool: EnterprisePostgresPool;
  job: Pick<EnterpriseTenantJobRecord, "tenantId" | "actorUserId">;
  traceId: string;
}) {
  return withEnterprisePostgresUnitOfWork(
    input.pool,
    createEnterpriseTenantContext({
      tenantId: input.job.tenantId,
      actorUserId: input.job.actorUserId,
      traceId: input.traceId,
    }),
    (unit) => unit.dataLifecycle.outstandingCount(),
  );
}

export async function executeTenantLifecycleAfterDeletionFence(input: {
  pool: EnterprisePostgresPool;
  job: EnterpriseTenantJobRecord;
  traceId: string;
  execute(): Promise<TenantLifecycleExecutionResult>;
}): Promise<TenantLifecycleExecutionResult> {
  const outstanding = input.job.type === "tenant.delete"
    ? await outstandingDataLifecycleJobs(input)
    : 0;
  if (outstanding > 0) return { status: "processing" };
  try {
    return await input.execute();
  } catch {
    return { status: "retry", reason: "executor_unavailable" };
  }
}

export async function runEnterpriseDataLifecycleClaim(input: {
  pool: EnterprisePostgresPool;
  store: EnterpriseAuditExportArtifactStore | undefined;
  job: EnterpriseDataLifecycleJob;
  now: Date;
  traceId: string;
  assertOwned(): Promise<void>;
}) {
  if (!input.store) {
    throw new Error("Enterprise data lifecycle artifact store is missing");
  }
  const job = await processEnterpriseDataLifecycleJob({
    pool: input.pool,
    store: input.store,
    job: input.job,
    now: input.now,
    traceId: input.traceId,
    beforeFinalize: input.assertOwned,
  });
  return job.status === "completed"
    ? "completed" as const
    : job.status === "failed" ? "failed" as const : "retried" as const;
}
