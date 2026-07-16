import {
  claimEnterpriseTenantLifecycleJob,
  finalizeEnterpriseTenantLifecycleJob,
  pendingEnterpriseTenantLifecycleJobIds,
} from "./enterprise-tenant-job.repository.js";
import type {
  TenantLifecycleExecutor,
  TenantLifecycleExecutionResult,
} from "./enterprise-tenant-lifecycle-executor.js";

const recoveryConcurrency = 4;

export async function processEnterpriseTenantLifecycleJob(
  jobId: string,
  executor: TenantLifecycleExecutor,
  options: { now?: Date; force?: boolean } = {},
) {
  const now = options.now ?? new Date();
  const claimed = claimEnterpriseTenantLifecycleJob({
    jobId,
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
    jobId,
    attempt: claimed.execution.job.attempt,
    result,
    now,
  });
}

export async function recoverPendingEnterpriseTenantLifecycleJobs(
  executor: TenantLifecycleExecutor,
  now = new Date(),
) {
  const jobIds = pendingEnterpriseTenantLifecycleJobIds(now);
  let completedCount = 0;
  let failedCount = 0;
  let processingCount = 0;
  for (let index = 0; index < jobIds.length; index += recoveryConcurrency) {
    const results = await Promise.all(
      jobIds.slice(index, index + recoveryConcurrency).map((jobId) =>
        processEnterpriseTenantLifecycleJob(jobId, executor, { now })
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
    inspectedCount: jobIds.length,
    completedCount,
    failedCount,
    processingCount,
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
