import {
  claimEnterpriseTenantLifecycleJob,
  finalizeEnterpriseTenantLifecycleJob,
  pendingEnterpriseTenantLifecycleJobRefs,
} from "./enterprise-tenant-job.repository.js";
import type {
  TenantLifecycleExecutor,
  TenantLifecycleExecutionResult,
} from "./enterprise-tenant-lifecycle-executor.js";
import {
  createEnterpriseTenantContext,
} from "./enterprise-tenant-context.js";
import type {
  EnterpriseTenantJobRecord,
} from "./enterprise-tenant-record.js";

const recoveryConcurrency = 4;

export async function processEnterpriseTenantLifecycleJob(
  jobRef: EnterpriseTenantLifecycleJobRef,
  executor: TenantLifecycleExecutor,
  options: { now?: Date; force?: boolean } = {},
) {
  const now = options.now ?? new Date();
  const context = createEnterpriseTenantContext({
    tenantId: jobRef.tenantId,
    actorUserId: jobRef.actorUserId,
    traceId: `tenant-job:${jobRef.jobId}`,
  });
  const claimed = claimEnterpriseTenantLifecycleJob({
    context,
    jobId: jobRef.jobId,
    now,
    force: options.force ?? false,
  });
  if (claimed.status !== "claimed") return claimed;
  let result: TenantLifecycleExecutionResult;
  try {
    result = await executor.execute(claimed.execution);
  } catch {
    result = { status: "retry", reason: "executor_unavailable" };
  }
  return finalizeEnterpriseTenantLifecycleJob({
    context,
    jobId: jobRef.jobId,
    attempt: claimed.execution.job.attempt,
    result,
    now,
  });
}

export async function recoverPendingEnterpriseTenantLifecycleJobs(
  executor: TenantLifecycleExecutor,
  now = new Date(),
) {
  const jobRefs = pendingEnterpriseTenantLifecycleJobRefs(now);
  let completedCount = 0;
  let failedCount = 0;
  let processingCount = 0;
  for (let index = 0; index < jobRefs.length; index += recoveryConcurrency) {
    const results = await Promise.all(
      jobRefs.slice(index, index + recoveryConcurrency).map((jobRef) =>
        processEnterpriseTenantLifecycleJob(jobRef, executor, { now })
      ),
    );
    for (const result of results) {
      if (!("job" in result) || !result.job) continue;
      if (result.job.status === "completed") completedCount += 1;
      else if (result.job.status === "failed") failedCount += 1;
      else processingCount += 1;
    }
  }
  return {
    inspectedCount: jobRefs.length,
    completedCount,
    failedCount,
    processingCount,
  };
}

export interface EnterpriseTenantLifecycleJobRef {
  jobId: string;
  tenantId: string;
  actorUserId: string;
}

export function enterpriseTenantLifecycleJobRef(
  job: Pick<EnterpriseTenantJobRecord, "id" | "tenantId" | "actorUserId">,
): EnterpriseTenantLifecycleJobRef {
  return {
    jobId: job.id,
    tenantId: job.tenantId,
    actorUserId: job.actorUserId,
  };
}

export function startEnterpriseTenantLifecycleRecovery(options: {
  executor: TenantLifecycleExecutor;
  intervalMs?: number;
  onResult?: (
    result: Awaited<
      ReturnType<typeof recoverPendingEnterpriseTenantLifecycleJobs>
    >,
  ) => void;
  onError?: (error: unknown) => void;
}) {
  const timer = setInterval(() => {
    void recoverPendingEnterpriseTenantLifecycleJobs(options.executor)
      .then((result) => options.onResult?.(result))
      .catch((error) => options.onError?.(error));
  }, Math.max(1_000, options.intervalMs ?? 5_000));
  timer.unref();
  return () => clearInterval(timer);
}
