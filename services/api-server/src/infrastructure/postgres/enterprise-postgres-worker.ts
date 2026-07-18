import type {
  TenantLifecycleExecutor,
} from "../../modules/enterprise/enterprise-tenant-lifecycle-executor.js";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
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
  listEnterprisePostgresPendingWork,
  type EnterprisePostgresPendingWorkRef,
} from "./enterprise-postgres-pending-work.repository.js";
import {
  withEnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";
import type {
  EnterprisePostgresWorkerConfig,
} from "./enterprise-postgres-worker-config.js";

export async function runEnterprisePostgresWorkerBatch(options: {
  discoveryPool: EnterprisePostgresPool;
  tenantPool: EnterprisePostgresPool;
  runtime: EnterpriseRepositoryRuntime;
  config: EnterprisePostgresWorkerConfig;
  lifecycleExecutor: TenantLifecycleExecutor;
  outboxPublisher: EnterpriseOutboxPublisher;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  const refs = await listEnterprisePostgresPendingWork({
    pool: options.discoveryPool,
    cellId: options.config.cellId,
    workerId: options.config.workerId,
    traceId: workerTrace(options.config.workerId, now),
    now: now.toISOString(),
    limit: options.config.batchSize,
  });
  const counts = {
    inspected: refs.length,
    completed: 0,
    retried: 0,
    busy: 0,
    failed: 0,
  };
  for (const ref of refs) {
    try {
      const result = await processRef(options, ref, now);
      counts[result] += 1;
    } catch {
      counts.failed += 1;
    }
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
  ref: EnterprisePostgresPendingWorkRef,
  now: Date,
): Promise<"completed" | "retried" | "busy"> {
  const traceId = `${workerTrace(options.config.workerId, now)}:${ref.resourceId}`;
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
    let result;
    try {
      result = await options.lifecycleExecutor.execute(execution);
    } catch {
      result = { status: "retry" as const, reason: "executor_unavailable" };
    }
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
  const event = claimed.result.event;
  let result;
  try {
    result = await options.outboxPublisher.publish(event);
  } catch {
    result = { status: "retry" as const, reason: "publisher_unavailable" };
  }
  await finalizeOutbox(options.tenantPool, event, result, now, traceId);
  return result.status === "completed" ? "completed" : "retried";
}

function finalizeOutbox(
  pool: EnterprisePostgresPool,
  event: import("../../modules/enterprise/enterprise-event-record.js").EnterpriseOutboxEventRecord,
  result: { status: "completed" } | { status: "retry"; reason: string },
  now: Date,
  traceId: string,
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
      traceId,
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
