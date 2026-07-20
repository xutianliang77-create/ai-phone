import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renew: vi.fn(),
  release: vi.fn(),
}));

vi.mock("./enterprise-postgres-worker-coordination.repository.js", () => ({
  renewEnterprisePostgresPendingWorkClaim: mocks.renew,
  releaseEnterprisePostgresPendingWorkClaim: mocks.release,
}));

import { withEnterprisePostgresWorkClaim } from
  "./enterprise-postgres-worker-coordination.js";

describe("enterprise PostgreSQL work claim heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.renew.mockResolvedValue(true);
    mocks.release.mockResolvedValue(true);
  });

  it("renews before side effects and releases after completion", async () => {
    const operation = vi.fn(async () => "completed");
    await expect(withEnterprisePostgresWorkClaim({
      pool: {} as never,
      claim: claim(),
      leaseMs: 30_000,
      traceId: "trace-work",
      operation,
    })).resolves.toBe("completed");

    expect(mocks.renew).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("does not execute after its owner or generation was fenced", async () => {
    mocks.renew.mockResolvedValue(false);
    const operation = vi.fn();
    await expect(withEnterprisePostgresWorkClaim({
      pool: {} as never,
      claim: claim(),
      leaseMs: 30_000,
      traceId: "trace-fenced",
      operation,
    })).rejects.toThrow("coordination claim lost");

    expect(operation).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("fences finalization when ownership is lost after a side effect", async () => {
    mocks.renew.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const sideEffect = vi.fn();
    const finalize = vi.fn();
    await expect(withEnterprisePostgresWorkClaim({
      pool: {} as never,
      claim: claim(),
      leaseMs: 30_000,
      traceId: "trace-lost-before-finalize",
      operation: async (lease) => {
        sideEffect();
        await lease.assertOwned();
        finalize();
      },
    })).rejects.toThrow("coordination claim lost");
    expect(sideEffect).toHaveBeenCalledOnce();
    expect(finalize).not.toHaveBeenCalled();
  });
});

function claim() {
  return {
    cellId: "cn-cell-01",
    tenantId: "00000000-0000-4000-8000-000000000001",
    workKind: "outbox" as const,
    resourceId: "00000000-0000-4000-8000-000000000002",
    coordination: {
      workerId: "worker-a",
      generation: "3",
      leaseExpiresAt: "2026-07-20T04:00:30.000Z",
    },
  };
}
