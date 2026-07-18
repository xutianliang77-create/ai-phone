import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  claim: vi.fn(),
  finalizeOutbox: vi.fn(),
}));

vi.mock("./enterprise-postgres-pending-work.repository.js", () => ({
  listEnterprisePostgresPendingWork: mocks.list,
  claimEnterprisePostgresPendingWork: mocks.claim,
}));
vi.mock("./enterprise-postgres-unit-of-work.js", () => ({
  withEnterprisePostgresUnitOfWork: (
    _pool: unknown,
    _context: unknown,
    operation: (unit: unknown) => unknown,
  ) => operation({ events: { finalizeOutbox: mocks.finalizeOutbox } }),
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
  });

  it("executes and finalizes claimed lifecycle work", async () => {
    mocks.list.mockResolvedValue([{
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
    mocks.list.mockResolvedValue([{
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

  it("isolates a failed item and keeps batch accounting explicit", async () => {
    mocks.list.mockResolvedValue([{
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
    mocks.list.mockRejectedValue(new Error("database unavailable"));
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
    now,
  };
}

function lifecycleJob() {
  return {
    id: jobId,
    tenantId,
    actorUserId,
    type: "tenant.export" as const,
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
