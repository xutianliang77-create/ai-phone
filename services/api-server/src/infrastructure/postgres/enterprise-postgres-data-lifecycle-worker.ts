import type { EnterpriseAuditExportArtifactStore } from
  "../../modules/enterprise/enterprise-audit-export-artifact-store.js";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterprisePostgresPool } from "./enterprise-postgres-client.js";
import type {
  EnterpriseDataLifecycleFinalization,
  EnterpriseDataLifecycleJob,
} from "./enterprise-postgres-data-lifecycle.repository.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

const maximumAttempts = 10;

export async function processEnterpriseDataLifecycleJob(input: {
  pool: EnterprisePostgresPool;
  store: EnterpriseAuditExportArtifactStore;
  job: EnterpriseDataLifecycleJob;
  now: Date;
  traceId: string;
  beforeFinalize?: () => Promise<void>;
}) {
  let deleted;
  try {
    deleted = await input.store.delete(input.job.objectKey);
  } catch {
    deleted = { status: "retry" as const,
      reasonCode: "audit_export_store_unavailable" };
  }
  const result: EnterpriseDataLifecycleFinalization = deleted.status === "converged"
    ? { status: "completed", outcome: deleted.outcome,
        receiptHash: deleted.receiptHash }
    : deleted.status === "failed" || input.job.attempts >= maximumAttempts
    ? { status: "failed", errorCode: safeErrorCode(deleted.reasonCode) }
    : { status: "retry", errorCode: safeErrorCode(deleted.reasonCode),
        nextAttemptAt: new Date(
          input.now.getTime() + retryDelay(input.job.attempts),
        ).toISOString() };
  await input.beforeFinalize?.();
  const context = createEnterpriseTenantContext({
    tenantId: input.job.tenantId,
    actorUserId: "system:enterprise-data-lifecycle",
    traceId: input.traceId,
  });
  return withEnterprisePostgresUnitOfWork(input.pool, context, async (unit) => {
    const finalized = await unit.dataLifecycle.finalize({
      id: input.job.id,
      attempt: input.job.attempts,
      now: input.now.toISOString(),
      result,
    });
    if (finalized.status !== "updated") {
      throw new Error("Enterprise data lifecycle finalize conflict");
    }
    if (result.status !== "retry") {
      await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
        context,
        action: result.status === "completed"
          ? "data_lifecycle.delete.complete"
          : "data_lifecycle.delete.fail",
        resourceType: "data_lifecycle_job",
        resourceId: input.job.id,
        result: result.status === "completed" ? "completed" : "failed",
        details: result.status === "completed" ? {
          dataClass: input.job.dataClass,
          sourceId: input.job.sourceId,
          retentionUntil: input.job.retentionUntil,
          outcome: result.outcome,
          receiptHash: result.receiptHash,
        } : {
          dataClass: input.job.dataClass,
          sourceId: input.job.sourceId,
          retentionUntil: input.job.retentionUntil,
          errorCode: result.errorCode,
        },
        createdAt: input.now.toISOString(),
      }));
    }
    return finalized.job;
  });
}

function retryDelay(attempt: number) {
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), 900_000);
}

function safeErrorCode(value: string) {
  return /^[a-z][a-z0-9_]{1,63}$/.test(value)
    ? value
    : "data_lifecycle_delete_failed";
}
