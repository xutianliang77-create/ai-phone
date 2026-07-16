import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import type {
  TenantLifecycleExecutionInput,
  TenantLifecycleExecutionResult,
} from "./enterprise-tenant-lifecycle-executor.js";
import type {
  EnterpriseMemberRecord,
  EnterpriseTenantJobRecord,
  EnterpriseTenantRecord,
} from "./enterprise-tenant-record.js";

const leaseDurationMs = 30_000;
const retryDelayMs = 5_000;
const maxAutomaticAttempts = 5;

export function claimEnterpriseTenantLifecycleJob(input: {
  jobId: string;
  now: Date;
  force: boolean;
}) {
  return runStoreTransaction(() => {
    const records = lifecycleRecords(input.jobId);
    if (!records) return { status: "not_found" as const };
    const { tenant, member, job } = records;
    if (!executableJob(job)) return { status: "unchanged" as const, ...records };
    if (job.status === "completed") {
      return { status: "unchanged" as const, ...records };
    }
    if (!job.scopeSnapshot) {
      job.status = "failed";
      job.errorCode = "scope_snapshot_missing";
      job.updatedAt = input.now.toISOString();
      persistStoreSnapshot();
      return { status: "invalid" as const, ...records };
    }
    if (future(job.leaseExpiresAt, input.now)) {
      return { status: "busy" as const, ...records };
    }
    if (!input.force && future(job.nextAttemptAt, input.now)) {
      return { status: "deferred" as const, ...records };
    }
    job.status = "processing";
    job.attempts = (job.attempts ?? 0) + 1;
    job.leaseExpiresAt = new Date(
      input.now.getTime() + leaseDurationMs,
    ).toISOString();
    job.updatedAt = input.now.toISOString();
    delete job.nextAttemptAt;
    delete job.errorCode;
    delete job.receiptRef;
    delete job.receiptHash;
    delete job.completedAt;
    persistStoreSnapshot();
    const execution: TenantLifecycleExecutionInput = {
      job: {
        id: job.id,
        tenantId: job.tenantId,
        type: job.type,
        attempt: job.attempts,
      },
      snapshot: structuredClone(job.scopeSnapshot),
    };
    return { status: "claimed" as const, tenant, member, job, execution };
  });
}

export function finalizeEnterpriseTenantLifecycleJob(input: {
  jobId: string;
  attempt: number;
  result: TenantLifecycleExecutionResult;
  now: Date;
}) {
  return runStoreTransaction(() => {
    const records = lifecycleRecords(input.jobId);
    if (!records) return { status: "not_found" as const };
    const { tenant, member, job } = records;
    if (
      job.status !== "processing" ||
      job.attempts !== input.attempt ||
      !executableJob(job)
    ) {
      return { status: "unchanged" as const, ...records };
    }
    const now = input.now.toISOString();
    delete job.leaseExpiresAt;
    job.updatedAt = now;
    if (input.result.status === "completed") {
      completeJob(job, input.result, now);
      if (job.type === "tenant.delete") tombstoneTenant(tenant, now);
    } else if (input.result.status === "failed") {
      failJob(job, input.result.reason);
    } else if (input.result.status === "retry") {
      retryJob(job, input.result.reason, input.now);
    } else {
      job.status = "processing";
      delete job.errorCode;
      job.nextAttemptAt = new Date(
        input.now.getTime() + retryDelayMs,
      ).toISOString();
    }
    persistStoreSnapshot();
    return { status: "updated" as const, tenant, member, job };
  });
}

export function pendingEnterpriseTenantLifecycleJobIds(now = new Date()) {
  return getStoreSnapshot().enterpriseTenantJobs
    .filter((job) =>
      executableJob(job) &&
      job.status === "processing" &&
      !future(job.leaseExpiresAt, now) &&
      !future(job.nextAttemptAt, now)
    )
    .sort((left, right) =>
      left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id)
    )
    .map((job) => job.id);
}

function lifecycleRecords(jobId: string): {
  tenant: EnterpriseTenantRecord;
  member: EnterpriseMemberRecord;
  job: EnterpriseTenantJobRecord;
} | null {
  const store = getStoreSnapshot();
  const job = store.enterpriseTenantJobs.find((item) => item.id === jobId);
  const tenant = job &&
    store.enterpriseTenants.find((item) => item.id === job.tenantId);
  const member = job && store.enterpriseMembers.find((item) =>
    item.tenantId === job.tenantId && item.userId === job.actorUserId
  );
  return job && tenant && member ? { tenant, member, job } : null;
}

function completeJob(
  job: EnterpriseTenantJobRecord,
  result: Extract<TenantLifecycleExecutionResult, { status: "completed" }>,
  now: string,
) {
  job.status = "completed";
  job.receiptRef = result.receiptRef;
  job.receiptHash = result.receiptHash;
  job.completedAt = now;
  delete job.errorCode;
  delete job.nextAttemptAt;
}

function failJob(job: EnterpriseTenantJobRecord, reason: string) {
  job.status = "failed";
  job.errorCode = safeErrorCode(reason);
  delete job.nextAttemptAt;
}

function retryJob(
  job: EnterpriseTenantJobRecord,
  reason: string,
  now: Date,
) {
  if (job.attempts >= maxAutomaticAttempts) {
    failJob(job, "executor_retry_exhausted");
    return;
  }
  job.status = "processing";
  job.errorCode = safeErrorCode(reason);
  const delay = Math.min(
    retryDelayMs * 2 ** Math.max(0, job.attempts - 1),
    60_000,
  );
  job.nextAttemptAt = new Date(now.getTime() + delay).toISOString();
}

function tombstoneTenant(tenant: EnterpriseTenantRecord, now: string) {
  tenant.status = "deleted";
  tenant.updatedAt = now;
  tenant.version += 1;
  for (const member of getStoreSnapshot().enterpriseMembers) {
    if (member.tenantId !== tenant.id || member.status === "suspended") continue;
    member.status = "suspended";
    member.updatedAt = now;
    member.version += 1;
  }
}

function executableJob(
  job: EnterpriseTenantJobRecord,
): job is EnterpriseTenantJobRecord & {
  type: "tenant.export" | "tenant.delete";
} {
  return job.type === "tenant.export" || job.type === "tenant.delete";
}

function future(value: string | undefined, now: Date) {
  return Boolean(value && Date.parse(value) > now.getTime());
}

function safeErrorCode(value: string) {
  return /^[a-z][a-z0-9_]{1,63}$/.test(value)
    ? value
    : "executor_failed";
}
