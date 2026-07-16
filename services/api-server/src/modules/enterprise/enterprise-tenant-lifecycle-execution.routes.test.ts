import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import type {
  TenantLifecycleExecutor,
} from "./enterprise-tenant-lifecycle-executor.js";
import {
  recoverPendingEnterpriseTenantLifecycleJobs,
} from "./enterprise-tenant-lifecycle-processor.js";

describe("enterprise tenant lifecycle execution routes", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.enterpriseTenants = [];
    store.enterpriseMembers = [];
    store.enterpriseTenantJobs = [];
  });

  it("completes an export only after a matching executor receipt", async () => {
    seedAccount("owner-user", "owner-token");
    const execute = vi.fn<TenantLifecycleExecutor["execute"]>(
      async ({ job }) => ({
        status: "completed",
        receiptRef: `object:${job.id}`,
        receiptHash: "a".repeat(64),
      }),
    );
    const app = await readyApp({ execute });
    const created = await createTenant(app, "Export Tenant", "create-export");
    const tenantId = created.json().tenant.id as string;
    const exported = await lifecycleRequest(app, tenantId, "export", "export-complete");
    const repeated = await lifecycleRequest(app, tenantId, "export", "export-complete");
    await app.close();

    expect(exported.statusCode).toBe(200);
    expect(exported.json().job).toMatchObject({
      status: "completed",
      attempts: 1,
      receiptHash: "a".repeat(64),
    });
    expect(repeated.json().job.id).toBe(exported.json().job.id);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0].snapshot).toMatchObject({
      actor: { userId: "owner-user", role: "owner" },
      tenant: { id: tenantId, name: "Export Tenant" },
      members: [{ userId: "owner-user", role: "owner" }],
    });
    expect(execute.mock.calls[0]?.[0].snapshot.tenantJobs)
      .toContainEqual(expect.objectContaining({ id: exported.json().job.id }));
  });

  it("retries the same failed delete job and tombstones memberships on completion", async () => {
    seedAccount("owner-user", "owner-token");
    seedAccount("other-user", "other-token");
    let ready = false;
    const execute = vi.fn<TenantLifecycleExecutor["execute"]>(
      async ({ job }) => ready
        ? {
            status: "completed",
            receiptRef: `deletion:${job.id}`,
            receiptHash: "b".repeat(64),
          }
        : { status: "failed", reason: "executor_not_ready" },
    );
    const app = await readyApp({ execute });
    const created = await createTenant(app, "Delete Tenant", "create-delete");
    const tenantId = created.json().tenant.id as string;
    const failed = await lifecycleRequest(app, tenantId, "delete", "delete-retry");
    ready = true;
    const completed = await lifecycleRequest(app, tenantId, "delete", "delete-retry");
    const ownerJob = await getJob(app, completed.json().job.id, "owner-token");
    const otherJob = await getJob(app, completed.json().job.id, "other-token");
    const memberships = await app.inject({
      method: "GET",
      url: "/enterprise/v1/tenants",
      headers: auth("owner-token"),
    });
    await app.close();

    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toMatchObject({
      tenant: { status: "deletion_requested" },
      job: { status: "failed", attempts: 1, errorCode: "executor_not_ready" },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      tenant: { status: "deleted" },
      job: { status: "completed", attempts: 2 },
    });
    expect(completed.json().job.id).toBe(failed.json().job.id);
    expect(ownerJob.statusCode).toBe(200);
    expect(otherJob.statusCode).toBe(404);
    expect(memberships.json().tenants).toEqual([]);
    expect(getStoreSnapshot().enterpriseMembers)
      .toEqual([expect.objectContaining({ tenantId, status: "suspended" })]);
  });

  it("recovers a processing export without changing its frozen snapshot", async () => {
    seedAccount("owner-user", "owner-token");
    let ready = false;
    const execute = vi.fn<TenantLifecycleExecutor["execute"]>(
      async ({ job }) => ready
        ? {
            status: "completed",
            receiptRef: `object:${job.id}`,
            receiptHash: "c".repeat(64),
          }
        : { status: "processing" },
    );
    const app = await readyApp({ execute });
    const created = await createTenant(app, "Recovery Tenant", "create-recovery");
    const tenantId = created.json().tenant.id as string;
    const exported = await lifecycleRequest(app, tenantId, "export", "export-recovery");
    ready = true;
    const recovery = await recoverPendingEnterpriseTenantLifecycleJobs(
      { execute },
      new Date(Date.now() + 10_000),
    );
    const job = await getJob(app, exported.json().job.id, "owner-token");
    await app.close();

    expect(exported.statusCode).toBe(202);
    expect(recovery).toMatchObject({ inspectedCount: 1, completedCount: 1 });
    expect(job.json().job.status).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0].snapshot)
      .toEqual(execute.mock.calls[0]?.[0].snapshot);
  });

  it("bounds automatic retries and exposes the terminal failure", async () => {
    seedAccount("owner-user", "owner-token");
    const executor: TenantLifecycleExecutor = {
      async execute() {
        return { status: "retry", reason: "executor_unavailable" };
      },
    };
    const app = await readyApp(executor);
    const created = await createTenant(app, "Retry Bound Tenant", "create-bound");
    const tenantId = created.json().tenant.id as string;
    const exported = await lifecycleRequest(app, tenantId, "export", "export-bound");
    let recovery;
    for (let attempt = 1; attempt < 5; attempt += 1) {
      recovery = await recoverPendingEnterpriseTenantLifecycleJobs(
        executor,
        new Date(Date.now() + attempt * 120_000),
      );
    }
    const job = await getJob(app, exported.json().job.id, "owner-token");
    await app.close();

    expect(exported.statusCode).toBe(202);
    expect(recovery).toMatchObject({ failedCount: 1 });
    expect(job.json().job).toMatchObject({
      status: "failed",
      attempts: 5,
      errorCode: "executor_retry_exhausted",
    });
  });

  it("blocks deletion while an export is still processing", async () => {
    seedAccount("owner-user", "owner-token");
    const app = await readyApp({
      async execute() {
        return { status: "processing" };
      },
    });
    const created = await createTenant(app, "Ordered Tenant", "create-ordered");
    const tenantId = created.json().tenant.id as string;
    const exported = await lifecycleRequest(app, tenantId, "export", "export-ordered");
    const deleted = await lifecycleRequest(app, tenantId, "delete", "delete-ordered");
    await app.close();

    expect(exported.statusCode).toBe(202);
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().error.code).toBe("tenant_lifecycle_pending");
    expect(getStoreSnapshot().enterpriseTenantJobs)
      .toHaveLength(2);
  });

  it("leases a repeated export so concurrent requests run one executor call", async () => {
    seedAccount("owner-user", "owner-token");
    let complete: (() => void) | undefined;
    const execute = vi.fn<TenantLifecycleExecutor["execute"]>(
      ({ job }) => new Promise((resolve) => {
        complete = () => resolve({
          status: "completed",
          receiptRef: `object:${job.id}`,
          receiptHash: "d".repeat(64),
        });
      }),
    );
    const app = await readyApp({ execute });
    const created = await createTenant(app, "Concurrent Tenant", "create-concurrent");
    const tenantId = created.json().tenant.id as string;
    const firstRequest = lifecycleRequest(
      app,
      tenantId,
      "export",
      "export-concurrent",
    );
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    const repeated = await lifecycleRequest(
      app,
      tenantId,
      "export",
      "export-concurrent",
    );
    complete?.();
    const first = await firstRequest;
    await app.close();

    expect(repeated.statusCode).toBe(202);
    expect(first.statusCode).toBe(200);
    expect(repeated.json().job.id).toBe(first.json().job.id);
    expect(execute).toHaveBeenCalledOnce();
  });
});

function seedAccount(userId: string, token: string) {
  const now = new Date().toISOString();
  const store = getStoreSnapshot();
  store.accounts.push({
    id: userId,
    phoneHash: `hash-${userId}`,
    phoneMasked: "138****0000",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  store.authSessions.push({
    token,
    userId,
    createdAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
}

function createTenant(
  app: Awaited<ReturnType<typeof buildApp>>,
  name: string,
  idempotencyKey: string,
) {
  return app.inject({
    method: "POST",
    url: "/saas/v1/tenants",
    headers: lifecycleHeaders(idempotencyKey),
    payload: { name, homeRegion: "cn" },
  });
}

function lifecycleRequest(
  app: Awaited<ReturnType<typeof buildApp>>,
  tenantId: string,
  action: "export" | "delete",
  idempotencyKey: string,
) {
  return app.inject({
    method: "POST",
    url: `/saas/v1/tenants/${tenantId}/${action}`,
    headers: lifecycleHeaders(idempotencyKey),
  });
}

function getJob(
  app: Awaited<ReturnType<typeof buildApp>>,
  jobId: string,
  token: string,
) {
  return app.inject({
    method: "GET",
    url: `/saas/v1/tenant-jobs/${jobId}`,
    headers: auth(token),
  });
}

function lifecycleHeaders(idempotencyKey: string) {
  return { ...auth("owner-token"), "idempotency-key": idempotencyKey };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function readyApp(tenantLifecycleExecutor: TenantLifecycleExecutor) {
  return buildApp({
    tenantProvisioner: {
      async provision() {
        return { status: "ready", cellId: "cn-cell-01" } as const;
      },
    },
    tenantLifecycleExecutor,
  });
}
