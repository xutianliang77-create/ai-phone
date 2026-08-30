import type {
  TenantLifecycleExecutionResult,
} from "../../modules/enterprise/enterprise-tenant-lifecycle-executor.js";
import {
  safeErrorCode,
  validCellId,
} from "../../modules/enterprise/enterprise-tenant-lifecycle-values.js";
import type {
  TenantProvisionResult,
} from "../../modules/enterprise/enterprise-tenant-provisioner.js";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseLifecycleResult,
} from "../../modules/enterprise/enterprise-repository-runtime.js";
import type {
  EnterpriseTenantJobRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";
import type {
  EnterprisePostgresPool,
} from "./enterprise-postgres-client.js";
import {
  withEnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";
import {
  executableLifecycleJob,
  lifecycleAuditEvent,
} from "./enterprise-postgres-runtime-lifecycle-records.js";

const leaseDurationMs = 30_000;
const retryDelayMs = 5_000;
const maxAutomaticAttempts = 5;

export function finalizePostgresTenantProvision(
  pool: EnterprisePostgresPool,
  input: {
    tenantId: string;
    actorUserId: string;
    jobId: string;
    result: TenantProvisionResult;
  },
): Promise<EnterpriseLifecycleResult> {
  return withEnterprisePostgresUnitOfWork(
    pool,
    createEnterpriseTenantContext({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      traceId: `tenant-job:${input.jobId}`,
    }),
    async (unit) => {
      const tenant = await unit.tenant.findTenant({ lock: true });
      const member = await unit.tenant.findMemberByUserId(input.actorUserId);
      const job = await unit.lifecycle.lockJob(input.jobId);
      if (!tenant || !member || !job) return { status: "not_found" };
      if (job.status !== "processing" || job.type !== "tenant.provision" ||
        tenant.status !== "provisioning") {
        return { status: "unchanged", tenant, member, job };
      }
      const now = new Date().toISOString();
      const readyCellId = input.result.status === "ready" &&
          validCellId(input.result.cellId)
        ? input.result.cellId
        : undefined;
      const ready = readyCellId !== undefined;
      const tenantUpdate = await unit.lifecycle.updateTenantStatus({
        status: ready ? "active" : "provisioning_failed",
        expectedVersion: tenant.version,
        updatedAt: now,
        ...(readyCellId ? { cellId: readyCellId } : {}),
      });
      if (tenantUpdate.status !== "updated") {
        throw new Error("Enterprise PostgreSQL provision tenant conflict");
      }
      const updatedJob: EnterpriseTenantJobRecord = {
        ...job,
        status: ready ? "completed" : "failed",
        updatedAt: now,
        ...(ready
          ? { completedAt: now }
          : {
              errorCode: input.result.status === "not_ready"
                ? safeErrorCode(input.result.reason)
                : "invalid_cell_id",
            }),
      };
      const jobUpdate = await unit.lifecycle.updateJob({
        job: updatedJob,
        expectedUpdatedAt: job.updatedAt,
      });
      if (jobUpdate.status !== "updated") {
        throw new Error("Enterprise PostgreSQL provision job conflict");
      }
      await unit.tenant.appendAuditEvent(lifecycleAuditEvent(
        jobUpdate.job,
        ready ? "completed" : "failed",
        `tenant-job:${job.id}`,
        now,
      ));
      return {
        status: "updated",
        tenant: tenantUpdate.tenant,
        member,
        job: jobUpdate.job,
      };
    },
  );
}

export function claimPostgresTenantLifecycleJob(
  pool: EnterprisePostgresPool,
  input: {
    context: import("../../modules/enterprise/enterprise-tenant-context.js").EnterpriseTenantContext;
    jobId: string;
    now: Date;
    force: boolean;
  },
): Promise<EnterpriseLifecycleResult> {
  return withEnterprisePostgresUnitOfWork(
    pool,
    input.context,
    async (unit) => {
      const tenant = await unit.tenant.findTenant();
      const member = await unit.tenant.findMemberByUserId(
        input.context.actorUserId,
      );
      const job = await unit.lifecycle.lockJob(input.jobId);
      if (!tenant || !member || !job) return { status: "not_found" };
      if (!executableLifecycleJob(job) || job.status !== "processing") {
        return { status: "unchanged", tenant, member, job };
      }
      if (!job.scopeSnapshot) {
        const failed = {
          ...job,
          status: "failed" as const,
          errorCode: "scope_snapshot_missing",
          updatedAt: input.now.toISOString(),
        };
        const updated = await unit.lifecycle.updateJob({
          job: failed,
          expectedUpdatedAt: job.updatedAt,
        });
        if (updated.status !== "updated") {
          throw new Error("Enterprise PostgreSQL invalid job conflict");
        }
        await unit.tenant.appendAuditEvent(lifecycleAuditEvent(
          updated.job,
          "failed",
          `tenant-job:${job.id}:${job.attempts}`,
          failed.updatedAt,
        ));
        return {
          status: "invalid",
          tenant,
          member,
          job: updated.job,
        };
      }
      if (future(job.leaseExpiresAt, input.now)) {
        return { status: "busy", tenant, member, job };
      }
      if (!input.force && future(job.nextAttemptAt, input.now)) {
        return { status: "deferred", tenant, member, job };
      }
      const now = input.now.toISOString();
      const claimed = await unit.lifecycle.claimJob({
        jobId: job.id,
        now,
        leaseExpiresAt: new Date(
          input.now.getTime() + leaseDurationMs,
        ).toISOString(),
        force: input.force,
      });
      if (claimed.status !== "claimed") {
        return { status: "busy", tenant, member, job };
      }
      return {
        status: "claimed",
        tenant,
        member,
        job: claimed.job,
        execution: {
          job: {
            id: claimed.job.id,
            tenantId: claimed.job.tenantId,
            type: claimed.job.type as "tenant.export" | "tenant.delete",
            attempt: claimed.job.attempts,
          },
          snapshot: structuredClone(claimed.job.scopeSnapshot!),
        },
      };
    },
  );
}

export function finalizePostgresTenantLifecycleJob(
  pool: EnterprisePostgresPool,
  input: {
    context: import("../../modules/enterprise/enterprise-tenant-context.js").EnterpriseTenantContext;
    jobId: string;
    attempt: number;
    result: TenantLifecycleExecutionResult;
    now: Date;
  },
): Promise<EnterpriseLifecycleResult> {
  return withEnterprisePostgresUnitOfWork(
    pool,
    input.context,
    async (unit) => {
      let tenant = await unit.tenant.findTenant({ lock: true });
      let member = await unit.tenant.findMemberByUserId(
        input.context.actorUserId,
      );
      const job = await unit.lifecycle.lockJob(input.jobId);
      if (!tenant || !member || !job) return { status: "not_found" };
      if (
        job.status !== "processing" ||
        job.attempts !== input.attempt ||
        !executableLifecycleJob(job)
      ) {
        return { status: "unchanged", tenant, member, job };
      }
      const now = input.now.toISOString();
      const next = finalizedJob(job, input.result, input.now);
      const jobUpdate = await unit.lifecycle.updateJob({
        job: next,
        expectedUpdatedAt: job.updatedAt,
      });
      if (jobUpdate.status !== "updated") {
        throw new Error("Enterprise PostgreSQL lifecycle finalize conflict");
      }
      if (input.result.status === "completed" && job.type === "tenant.delete") {
        const tenantUpdate = await unit.lifecycle.updateTenantStatus({
          status: "deleted",
          expectedVersion: tenant.version,
          updatedAt: now,
        });
        if (tenantUpdate.status !== "updated") {
          throw new Error("Enterprise PostgreSQL tenant delete conflict");
        }
        tenant = tenantUpdate.tenant;
        await unit.lifecycle.suspendMembers(now);
        member = await unit.tenant.findMemberByUserId(input.context.actorUserId) ??
          member;
      }
      const terminalResult = jobUpdate.job.status === "completed"
        ? "completed"
        : jobUpdate.job.status === "failed"
        ? "failed"
        : null;
      if (terminalResult) {
        await unit.tenant.appendAuditEvent(lifecycleAuditEvent(
          jobUpdate.job,
          terminalResult,
          `tenant-job:${job.id}:${jobUpdate.job.attempts}`,
          now,
        ));
      }
      return {
        status: "updated",
        tenant,
        member,
        job: jobUpdate.job,
      };
    },
  );
}

function finalizedJob(
  job: EnterpriseTenantJobRecord,
  result: TenantLifecycleExecutionResult,
  now: Date,
): EnterpriseTenantJobRecord {
  const updated: EnterpriseTenantJobRecord = {
    ...job,
    updatedAt: now.toISOString(),
  };
  delete updated.leaseExpiresAt;
  if (result.status === "completed") {
    updated.status = "completed";
    updated.receiptRef = result.receiptRef;
    updated.receiptHash = result.receiptHash;
    updated.completedAt = updated.updatedAt;
    delete updated.errorCode;
    delete updated.nextAttemptAt;
  } else if (result.status === "failed") {
    failJob(updated, result.reason);
  } else if (result.status === "retry") {
    if (updated.attempts >= maxAutomaticAttempts) {
      failJob(updated, "executor_retry_exhausted");
    } else {
      updated.status = "processing";
      updated.errorCode = jobError(result.reason);
      const delay = Math.min(
        retryDelayMs * 2 ** Math.max(0, updated.attempts - 1),
        60_000,
      );
      updated.nextAttemptAt = new Date(now.getTime() + delay).toISOString();
    }
  } else {
    updated.status = "processing";
    delete updated.errorCode;
    updated.nextAttemptAt = new Date(
      now.getTime() + retryDelayMs,
    ).toISOString();
  }
  return updated;
}

function failJob(job: EnterpriseTenantJobRecord, reason: string) {
  job.status = "failed";
  job.errorCode = jobError(reason);
  delete job.nextAttemptAt;
}

function jobError(value: string) {
  return /^[a-z][a-z0-9_]{1,63}$/.test(value) ? value : "executor_failed";
}

function future(value: string | undefined, now: Date) {
  return Boolean(value && Date.parse(value) > now.getTime());
}
