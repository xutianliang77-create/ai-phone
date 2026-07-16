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
import {
  legacyEnterpriseRepositoryRuntime,
  type EnterpriseRepositoryRuntime,
} from "./enterprise-repository-runtime.js";

const recoveryConcurrency = 4;

export async function processEnterpriseTenantLifecycleJob(
  jobRef: EnterpriseTenantLifecycleJobRef,
  executor: TenantLifecycleExecutor,
  options: {
    now?: Date;
    force?: boolean;
    runtime?: EnterpriseRepositoryRuntime;
  } = {},
) {
  const now = options.now ?? new Date();
  const runtime = options.runtime ?? legacyEnterpriseRepositoryRuntime;
  const context = createEnterpriseTenantContext({
    tenantId: jobRef.tenantId,
    actorUserId: jobRef.actorUserId,
    traceId: `tenant-job:${jobRef.jobId}`,
  });
  const claimed = await runtime.claimTenantLifecycleJob({
    context,
    jobId: jobRef.jobId,
    now,
    force: options.force ?? false,
  });
  if (claimed.status !== "claimed" || !claimed.execution) return claimed;
  let result: TenantLifecycleExecutionResult;
  try {
    result = await executor.execute(claimed.execution);
  } catch {
    result = { status: "retry", reason: "executor_unavailable" };
  }
  return runtime.finalizeTenantLifecycleJob({
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
  runtime: EnterpriseRepositoryRuntime = legacyEnterpriseRepositoryRuntime,
) {
  const jobRefs = await runtime.pendingTenantLifecycleJobRefs(now);
  let completedCount = 0;
  let failedCount = 0;
  let processingCount = 0;
  for (let index = 0; index < jobRefs.length; index += recoveryConcurrency) {
    const results = await Promise.all(
      jobRefs.slice(index, index + recoveryConcurrency).map((jobRef) =>
        processEnterpriseTenantLifecycleJob(jobRef, executor, { now, runtime })
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
  runtime?: EnterpriseRepositoryRuntime;
  intervalMs?: number;
  onResult?: (
    result: Awaited<
      ReturnType<typeof recoverPendingEnterpriseTenantLifecycleJobs>
    >,
  ) => void;
  onError?: (error: unknown) => void;
}) {
  const timer = setInterval(() => {
    void recoverPendingEnterpriseTenantLifecycleJobs(
      options.executor,
      new Date(),
      options.runtime,
    )
      .then((result) => options.onResult?.(result))
      .catch((error) => options.onError?.(error));
  }, Math.max(1_000, options.intervalMs ?? 5_000));
  timer.unref();
  return () => clearInterval(timer);
}
