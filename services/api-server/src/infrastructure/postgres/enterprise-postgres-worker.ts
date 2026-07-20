import type {
  TenantLifecycleExecutor,
} from "../../modules/enterprise/enterprise-tenant-lifecycle-executor.js";
import type { EnterpriseAuditExportArtifactStore } from
  "../../modules/enterprise/enterprise-audit-export-artifact-store.js";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import { runWithPlatformTraceId } from
  "../observability/platform-telemetry.js";
import type {
  EnterpriseOutboxPublisher,
} from "../../modules/enterprise/enterprise-outbox-processor.js";
import type {
  EnterpriseRepositoryRuntime,
} from "../../modules/enterprise/enterprise-repository-runtime.js";
import type {
  EnterprisePostgresPool,
} from "./enterprise-postgres-client.js";
import {
  claimEnterprisePostgresPendingWork,
} from "./enterprise-postgres-pending-work.repository.js";
import {
  claimEnterprisePostgresPendingWorkBatch,
  type EnterprisePostgresPendingWorkClaim,
} from "./enterprise-postgres-worker-coordination.repository.js";
import { withEnterprisePostgresWorkClaim } from
  "./enterprise-postgres-worker-coordination.js";
import {
  withEnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";
import type {
  EnterprisePostgresWorkerConfig,
} from "./enterprise-postgres-worker-config.js";
import { processEnterpriseAuditExport } from
  "./enterprise-postgres-audit-export-worker.js";
import {
  executeTenantLifecycleAfterDeletionFence,
  runEnterpriseDataLifecycleClaim,
} from
  "./enterprise-postgres-worker-data-lifecycle.js";

export async function runEnterprisePostgresWorkerBatch(options: {
  discoveryPool: EnterprisePostgresPool;
  tenantPool: EnterprisePostgresPool;
  runtime: EnterpriseRepositoryRuntime;
  config: EnterprisePostgresWorkerConfig;
  lifecycleExecutor: TenantLifecycleExecutor;
  outboxPublisher: EnterpriseOutboxPublisher;
  auditExportArtifactStore?: EnterpriseAuditExportArtifactStore;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  const refs = await claimEnterprisePostgresPendingWorkBatch({
    pool: options.discoveryPool,
    cellId: options.config.cellId,
    workerId: options.config.workerId,
    traceId: workerTrace(options.config.workerId, now),
    leaseMs: options.config.leaseMs,
    limit: options.config.batchSize,
  });
  const counts = {
    inspected: refs.length,
    completed: 0,
    retried: 0,
    busy: 0,
    failed: 0,
  };
  const results = await Promise.all(refs.map(async (ref) => {
    try { return await processRef(options, ref, now); }
    catch { return "failed" as const; }
  }));
  for (const result of results) {
    counts[result] += 1;
  }
  return counts;
}

export async function runEnterprisePostgresWorkerLoop(options: {
  discoveryPool: EnterprisePostgresPool;
  tenantPool: EnterprisePostgresPool;
  runtime: EnterpriseRepositoryRuntime;
  config: EnterprisePostgresWorkerConfig;
  lifecycleExecutor: TenantLifecycleExecutor;
  outboxPublisher: EnterpriseOutboxPublisher;
  auditExportArtifactStore?: EnterpriseAuditExportArtifactStore;
  signal: AbortSignal;
  onBatch?: (
    result: Awaited<ReturnType<typeof runEnterprisePostgresWorkerBatch>>,
  ) => void;
  onError?: (error: unknown) => void;
}) {
  while (!options.signal.aborted) {
    try {
      const result = await runEnterprisePostgresWorkerBatch(options);
      options.onBatch?.(result);
    } catch (error) {
      options.onError?.(error);
    }
    await waitForNextPoll(options.config.pollIntervalMs, options.signal);
  }
}

async function processRef(
  options: Parameters<typeof runEnterprisePostgresWorkerBatch>[0],
  ref: EnterprisePostgresPendingWorkClaim,
  now: Date,
): Promise<"completed" | "retried" | "busy" | "failed"> {
  const traceId = `${workerTrace(options.config.workerId, now)}:${ref.resourceId}`;
  return withEnterprisePostgresWorkClaim({
    pool: options.discoveryPool,
    claim: ref,
    leaseMs: options.config.leaseMs,
    traceId,
    operation: (lease) => processClaimedRef(options, ref, now, traceId, lease),
  });
}

async function processClaimedRef(
  options: Parameters<typeof runEnterprisePostgresWorkerBatch>[0],
  ref: EnterprisePostgresPendingWorkClaim,
  now: Date,
  traceId: string,
  lease: { assertOwned(): Promise<void> },
): Promise<"completed" | "retried" | "busy" | "failed"> {
  const claimed = await claimEnterprisePostgresPendingWork({
    pool: options.tenantPool,
    cellId: options.config.cellId,
    ref,
    now: now.toISOString(),
    leaseExpiresAt: new Date(
      now.getTime() + options.config.leaseMs,
    ).toISOString(),
    traceId,
  });
  if (claimed.result.status !== "claimed") return "busy";
  if (claimed.workKind === "screen_share") return "completed";
  await lease.assertOwned();
  if (claimed.workKind === "tenant_lifecycle") {
    const job = claimed.result.job;
    const execution = {
      job: {
        id: job.id,
        tenantId: job.tenantId,
        type: job.type as "tenant.export" | "tenant.delete",
        attempt: job.attempts,
      },
      snapshot: structuredClone(job.scopeSnapshot!),
    };
    const result = await executeTenantLifecycleAfterDeletionFence({
      pool: options.tenantPool, job, traceId,
      execute: () => options.lifecycleExecutor.execute(execution),
    });
    await lease.assertOwned();
    const finalized = await options.runtime.finalizeTenantLifecycleJob({
      context: createEnterpriseTenantContext({
        tenantId: job.tenantId,
        actorUserId: job.actorUserId,
        traceId,
      }),
      jobId: job.id,
      attempt: job.attempts,
      result,
      now,
    });
    return finalized.job?.status === "completed" ? "completed" : "retried";
  }
  if (claimed.workKind === "audit_export") {
    if (!options.auditExportArtifactStore) {
      throw new Error("Enterprise audit export artifact store is missing");
    }
    const auditExport = await processEnterpriseAuditExport({
      pool: options.tenantPool,
      store: options.auditExportArtifactStore,
      auditExport: claimed.result.auditExport,
      now,
      traceId,
      beforeFinalize: lease.assertOwned,
    });
    return auditExport.status === "completed"
      ? "completed"
      : auditExport.status === "failed" ? "failed" : "retried";
  }
  if (claimed.workKind === "data_lifecycle") {
    return runEnterpriseDataLifecycleClaim({
      pool: options.tenantPool, store: options.auditExportArtifactStore,
      job: claimed.result.job, now, traceId, assertOwned: lease.assertOwned,
    });
  }
  const event = claimed.result.event;
  let result;
  try {
    result = await runWithPlatformTraceId(
      event.traceId,
      () => options.outboxPublisher.publish(event),
    );
  } catch {
    result = { status: "retry" as const, reason: "publisher_unavailable" };
  }
  await lease.assertOwned();
  if (event.eventType === "meeting.calendar.create.requested") {
    if (!options.runtime.finalizeMeetingCalendarOutbox) {
      throw new Error("Meeting calendar runtime is missing");
    }
    const finalized = await options.runtime.finalizeMeetingCalendarOutbox({
      context: createEnterpriseTenantContext({
        tenantId: event.tenantId,
        actorUserId: "system:enterprise-calendar",
        traceId: event.traceId,
      }),
      eventId: event.id,
      attempt: event.attempts,
      result: meetingCalendarResult(result),
      now,
    });
    return finalized.status === "completed" ? "completed" :
      finalized.status === "retried" ? "retried" : "failed";
  }
  if (event.eventType === "marketing.crm.sync.requested") {
    if (!options.runtime.finalizeMarketingCrmOutbox) {
      throw new Error("Marketing CRM runtime is missing");
    }
    const finalized = await options.runtime.finalizeMarketingCrmOutbox({
      context: createEnterpriseTenantContext({ tenantId: event.tenantId,
        actorUserId: "system:enterprise-marketing-crm", traceId: event.traceId }),
      eventId: event.id, attempt: event.attempts,
      result: marketingCrmResult(result), now,
    });
    return finalized.status === "completed" ? "completed" :
      finalized.status === "retried" ? "retried" : "failed";
  }
  if (event.eventType === "support.tool.write.requested") {
    if (!options.runtime.finalizeSupportWriteToolOutbox) {
      throw new Error("Support write tool runtime is missing");
    }
    const finalized = await options.runtime.finalizeSupportWriteToolOutbox({
      context: createEnterpriseTenantContext({
        tenantId: event.tenantId,
        actorUserId: "system:enterprise-support-write",
        traceId: event.traceId,
      }),
      eventId: event.id,
      attempt: event.attempts,
      result: supportWriteResult(result),
      now,
    });
    return finalized.status;
  }
  if (event.eventType === "support.followup.requested") {
    if (!options.runtime.finalizeSupportFollowupOutbox) {
      throw new Error("Support followup runtime is missing");
    }
    const finalized = await options.runtime.finalizeSupportFollowupOutbox({
      context: createEnterpriseTenantContext({
        tenantId: event.tenantId,
        actorUserId: "system:enterprise-support-followup",
        traceId: event.traceId,
      }),
      eventId: event.id,
      attempt: event.attempts,
      result: supportWriteResult(result),
      now,
    });
    return finalized.status;
  }
  await finalizeOutbox(options.tenantPool, event, result, now);
  return result.status === "completed" ? "completed" : "retried";
}

function finalizeOutbox(
  pool: EnterprisePostgresPool,
  event: import("../../modules/enterprise/enterprise-event-record.js").EnterpriseOutboxEventRecord,
  result: { status: "completed" } | { status: "retry"; reason: string },
  now: Date,
) {
  const availableAt = result.status === "completed"
    ? now.toISOString()
    : new Date(
        now.getTime() +
          Math.min(1_000 * 2 ** Math.max(0, event.attempts - 1), 300_000),
      ).toISOString();
  return withEnterprisePostgresUnitOfWork(
    pool,
    createEnterpriseTenantContext({
      tenantId: event.tenantId,
      actorUserId: "system:enterprise-outbox",
      traceId: event.traceId,
    }),
    async (unit) => {
      const updated = await unit.events.finalizeOutbox({
        eventId: event.id,
        attempt: event.attempts,
        availableAt,
        ...(result.status === "completed"
          ? { publishedAt: now.toISOString() }
          : { lastErrorCode: safeErrorCode(result.reason) }),
      });
      if (updated.status !== "updated") {
        throw new Error("Enterprise PostgreSQL outbox finalize conflict");
      }
      return updated;
    },
  );
}

function workerTrace(workerId: string, now: Date) {
  return `enterprise-worker:${workerId}:${now.getTime()}`;
}

function safeErrorCode(value: string) {
  return /^[a-z][a-z0-9_]{1,63}$/.test(value) ? value : "publisher_failed";
}

function meetingCalendarResult(result: Awaited<ReturnType<
  EnterpriseOutboxPublisher["publish"]>>) {
  if (result.status === "retry") return result;
  return result.receipt?.kind === "meeting_calendar"
    ? { status: "completed" as const, receipt: result.receipt }
    : { status: "retry" as const, reason: "calendar_provider_receipt_invalid" };
}

function marketingCrmResult(result: Awaited<ReturnType<
  EnterpriseOutboxPublisher["publish"]>>) {
  if (result.status === "retry") return result;
  return result.receipt?.kind === "marketing_crm"
    ? { status: "completed" as const, receipt: result.receipt }
    : { status: "retry" as const, reason: "crm_provider_receipt_invalid" };
}

function supportWriteResult(result: Awaited<ReturnType<
  EnterpriseOutboxPublisher["publish"]>>) {
  if (result.status === "retry") return result;
  return result.receipt?.kind === "support_write_tool"
    ? { status: "completed" as const, receipt: result.receipt }
    : { status: "retry" as const, reason: "support_write_tool_receipt_invalid" };
}

function waitForNextPoll(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
