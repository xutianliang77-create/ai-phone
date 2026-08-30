import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimBatch: vi.fn(),
  claim: vi.fn(),
  finalizeOutbox: vi.fn(),
  finalizeDataLifecycle: vi.fn(),
  appendAudit: vi.fn(),
  outstandingDataLifecycle: vi.fn(),
  billingLifecycle: vi.fn(),
}));

vi.mock("./enterprise-postgres-pending-work.repository.js", () => ({
  claimEnterprisePostgresPendingWork: mocks.claim,
}));
vi.mock("./enterprise-postgres-worker-coordination.repository.js", () => ({
  claimEnterprisePostgresPendingWorkBatch: mocks.claimBatch,
}));
vi.mock("./enterprise-postgres-worker-coordination.js", () => ({
  withEnterprisePostgresWorkClaim: (input: {
    operation: (lease: { assertOwned(): Promise<void> }) => unknown;
  }) => input.operation({ assertOwned: async () => undefined }),
}));
vi.mock("./enterprise-postgres-unit-of-work.js", () => ({
  withEnterprisePostgresUnitOfWork: (
    _pool: unknown,
    _context: unknown,
    operation: (unit: unknown) => unknown,
  ) => operation({
    events: { finalizeOutbox: mocks.finalizeOutbox },
    dataLifecycle: {
      finalize: mocks.finalizeDataLifecycle,
      outstandingCount: mocks.outstandingDataLifecycle,
    },
    tenant: { appendAuditEvent: mocks.appendAudit },
  }),
}));
vi.mock("./enterprise-postgres-worker-billing-lifecycle.js", () => ({
  finishEnterpriseBillingLifecycleWork: mocks.billingLifecycle,
}));

import {
  runEnterprisePostgresWorkerBatch,
  runEnterprisePostgresWorkerLoop,
} from "./enterprise-postgres-worker.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const actorUserId = "user_00000000-0000-4000-8000-000000000003";
const now = new Date("2026-07-17T00:00:00.000Z");

describe("enterprise PostgreSQL cell worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.outstandingDataLifecycle.mockResolvedValue(0);
    mocks.appendAudit.mockResolvedValue(undefined);
    mocks.billingLifecycle.mockResolvedValue("completed");
  });

  it("executes and finalizes claimed lifecycle work", async () => {
    mocks.claimBatch.mockResolvedValue([{
      cellId: "cn-cell-01",
      tenantId,
      workKind: "tenant_lifecycle",
      resourceId: jobId,
      actorUserId,
    }]);
    mocks.claim.mockResolvedValue({
      workKind: "tenant_lifecycle",
      result: {
        status: "claimed",
        job: lifecycleJob(),
      },
    });
    const finalize = vi.fn(async () => ({
      status: "updated",
      job: { ...lifecycleJob(), status: "completed" },
    }));
    const result = await runEnterprisePostgresWorkerBatch(fixture({
      finalizeTenantLifecycleJob: finalize,
      execute: vi.fn(async () => ({
        status: "completed",
        receiptRef: "receipt:1",
        receiptHash: "a".repeat(64),
      })),
    }));

    expect(result).toEqual({
      inspected: 1,
      completed: 1,
      retried: 0,
      busy: 0,
      failed: 0,
    });
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({
      jobId,
      attempt: 1,
    }));
  });

  it("records retry state for an unavailable outbox publisher", async () => {
    const event = {
      id: jobId,
      tenantId,
      aggregateType: "tenant",
      aggregateId: tenantId,
      eventType: "tenant.updated",
      idempotencyKey: "event-1",
      payload: {},
      traceId: "trace",
      attempts: 2,
      availableAt: now.toISOString(),
      createdAt: now.toISOString(),
    };
    mocks.claimBatch.mockResolvedValue([{
      cellId: "cn-cell-01",
      tenantId,
      workKind: "outbox",
      resourceId: event.id,
    }]);
    mocks.claim.mockResolvedValue({
      workKind: "outbox",
      result: { status: "claimed", event },
    });
    mocks.finalizeOutbox.mockResolvedValue({
      status: "updated",
      event,
    });
    const result = await runEnterprisePostgresWorkerBatch(fixture({
      publish: vi.fn(async () => ({
        status: "retry",
        reason: "publisher_unavailable",
      })),
    }));

    expect(result.retried).toBe(1);
    expect(mocks.finalizeOutbox).toHaveBeenCalledWith(expect.objectContaining({
      eventId: event.id,
      attempt: 2,
      lastErrorCode: "publisher_unavailable",
    }));
  });

  it("deletes an expired artifact and commits only a verified receipt", async () => {
    const job = dataLifecycleJob();
    mocks.claimBatch.mockResolvedValue([{
      cellId: "cn-cell-01", tenantId, workKind: "data_lifecycle",
      resourceId: job.id,
    }]);
    mocks.claim.mockResolvedValue({
      workKind: "data_lifecycle", result: { status: "claimed", job },
    });
    mocks.finalizeDataLifecycle.mockResolvedValue({
      status: "updated", job: { ...job, status: "completed" },
    });
    const remove = vi.fn(async () => ({
      status: "converged" as const, outcome: "deleted" as const,
      receiptHash: "b".repeat(64),
    }));
    const result = await runEnterprisePostgresWorkerBatch(fixture({
      delete: remove,
    }));
    expect(result.completed).toBe(1);
    expect(remove).toHaveBeenCalledWith(job.objectKey);
    expect(mocks.finalizeDataLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: job.id, attempt: 1,
        result: { status: "completed", outcome: "deleted",
          receiptHash: "b".repeat(64) },
      }),
    );
  });

  it("hands a claimed billing command to the fenced lifecycle worker", async () => {
    const command = { id: jobId, tenantId, eventId: jobId,
      status: "processing", dueAt: now.toISOString(), attempts: 1,
      leaseOwner: "worker-01", leaseGeneration: 1,
      leaseExpiresAt: new Date(now.getTime() + 30_000).toISOString(),
      createdAt: now.toISOString(), updatedAt: now.toISOString(), version: 2 };
    mocks.claimBatch.mockResolvedValue([{ cellId: "cn-cell-01", tenantId,
      workKind: "billing_lifecycle", resourceId: jobId }]);
    mocks.claim.mockResolvedValue({ workKind: "billing_lifecycle",
      result: { status: "claimed", command } });
    const result = await runEnterprisePostgresWorkerBatch(fixture({}));
    expect(result.completed).toBe(1);
    expect(mocks.billingLifecycle).toHaveBeenCalledWith(
      expect.anything(), { status: "claimed", command }, "worker-01",
      expect.stringContaining(jobId), expect.any(Function),
    );
  });

  it("does not invoke tenant deletion while object work is outstanding", async () => {
    const job = lifecycleJob("tenant.delete");
    mocks.claimBatch.mockResolvedValue([{
      cellId: "cn-cell-01", tenantId, workKind: "tenant_lifecycle",
      resourceId: job.id, actorUserId,
    }]);
    mocks.claim.mockResolvedValue({
      workKind: "tenant_lifecycle", result: { status: "claimed", job },
    });
    mocks.outstandingDataLifecycle.mockResolvedValue(1);
    const execute = vi.fn();
    const finalize = vi.fn(async () => ({
      status: "updated", job: { ...job, status: "processing" },
    }));
    const result = await runEnterprisePostgresWorkerBatch(fixture({
      execute, finalizeTenantLifecycleJob: finalize,
    }));
    expect(result.retried).toBe(1);
    expect(execute).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({
      result: { status: "processing" },
    }));
  });

  it("isolates a failed item and keeps batch accounting explicit", async () => {
    mocks.claimBatch.mockResolvedValue([{
      cellId: "cn-cell-01",
      tenantId,
      workKind: "tenant_lifecycle",
      resourceId: jobId,
      actorUserId,
    }]);
    mocks.claim.mockRejectedValue(new Error("database unavailable"));
    const result = await runEnterprisePostgresWorkerBatch(fixture({}));
    expect(result).toEqual({
      inspected: 1,
      completed: 0,
      retried: 0,
      busy: 0,
      failed: 1,
    });
  });

  it("reports a failed poll without terminating the worker loop", async () => {
    const controller = new AbortController();
    const onError = vi.fn(() => controller.abort());
    mocks.claimBatch.mockRejectedValue(new Error("database unavailable"));
    await runEnterprisePostgresWorkerLoop({
      ...fixture({}),
      signal: controller.signal,
      onError,
    });
    expect(onError).toHaveBeenCalledOnce();
  });
});

function fixture(overrides: Record<string, unknown>) {
  return {
    discoveryPool: {} as never,
    tenantPool: {} as never,
    runtime: {
      driver: "postgres",
      finalizeTenantLifecycleJob: overrides.finalizeTenantLifecycleJob,
    } as never,
    config: {
      cellId: "cn-cell-01",
      workerId: "worker-01",
      pollIntervalMs: 5_000,
      batchSize: 25,
      leaseMs: 30_000,
    },
    lifecycleExecutor: {
      execute: overrides.execute ?? vi.fn(),
    } as never,
    outboxPublisher: {
      publish: overrides.publish ?? vi.fn(),
    } as never,
    ...(overrides.delete ? { auditExportArtifactStore: {
      ready: true, put: vi.fn(), get: vi.fn(), delete: overrides.delete,
      close: vi.fn(),
    } as never } : {}),
    now,
  };
}

function lifecycleJob(type: "tenant.export" | "tenant.delete" = "tenant.export") {
  return {
    id: jobId,
    tenantId,
    actorUserId,
    type,
    idempotencyKey: "job-1",
    requestHash: "a".repeat(64),
    status: "processing" as const,
    attempts: 1,
    scopeSnapshot: {
      requestedAt: now.toISOString(),
      actor: { userId: actorUserId, role: "owner" as const, scopes: [] },
      tenant: {
        id: tenantId,
        name: "Tenant",
        status: "active" as const,
        homeRegion: "cn",
        planCode: "enterprise_trial",
        dataRetentionDays: 30,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        version: 1,
      },
      members: [],
      tenantJobs: [],
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function dataLifecycleJob() {
  return {
    id: jobId, tenantId, jobType: "object.delete" as const,
    dataClass: "audit_export" as const, sourceId: jobId,
    objectKey: `audit-exports/tenants/${tenantId}/${jobId}.jsonl`,
    objectSha256: "a".repeat(64), sizeBytes: 10, retentionDays: 7,
    retentionUntil: now.toISOString(), status: "processing" as const,
    attempts: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
}
