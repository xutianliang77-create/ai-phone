import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import type {
  TenantLifecycleExecutor,
} from "./enterprise-tenant-lifecycle-executor.js";

describe("enterprise tenant lifecycle routes", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.enterpriseTenants = [];
    store.enterpriseMembers = [];
    store.enterpriseTenantJobs = [];
  });

  it("requires an idempotency key and does not duplicate provisioning", async () => {
    seedAccount("owner-user", "owner-token");
    let provisionCalls = 0;
    const app = await buildApp({
      tenantProvisioner: {
        async provision() {
          provisionCalls += 1;
          return { status: "ready", cellId: "cn-cell-01" } as const;
        },
      },
    });
    const missingKey = await app.inject({
      method: "POST",
      url: "/saas/v1/tenants",
      headers: auth("owner-token"),
      payload: { name: "Acme Global", homeRegion: "cn" },
    });
    const first = await createTenant(app, "Acme Global", "tenant-create-1");
    const repeated = await createTenant(app, "Acme Global", "tenant-create-1");
    const conflict = await createTenant(app, "Different Name", "tenant-create-1");
    await app.close();

    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().error.code).toBe("idempotency_key_required");
    expect(first.statusCode).toBe(201);
    expect(first.json().tenant).toMatchObject({
      status: "active",
      cellId: "cn-cell-01",
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().tenant.id).toBe(first.json().tenant.id);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("idempotency_conflict");
    expect(provisionCalls).toBe(1);
  });

  it("keeps a tenant non-active when regional provisioning is unavailable", async () => {
    seedAccount("owner-user", "owner-token");
    const app = await buildApp({
      tenantProvisioner: {
        async provision() {
          return { status: "not_ready", reason: "cell_not_configured" } as const;
        },
      },
    });
    const failed = await createTenant(app, "Acme Global", "tenant-create-failed");
    await app.close();

    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toMatchObject({
      tenant: { status: "provisioning_failed" },
      job: { type: "tenant.provision", status: "failed" },
      error: { code: "tenant_provisioning_failed" },
    });
    expect(getStoreSnapshot().enterpriseTenants).toHaveLength(1);
  });

  it("retries failed provisioning without creating a second tenant", async () => {
    seedAccount("owner-user", "owner-token");
    let ready = false;
    const app = await buildApp({
      tenantProvisioner: {
        async provision() {
          return ready
            ? { status: "ready", cellId: "cn-cell-02" } as const
            : { status: "not_ready", reason: "cell_not_configured" } as const;
        },
      },
    });
    const failed = await createTenant(app, "Retry Tenant", "create-retry-tenant");
    const tenantId = failed.json().tenant.id as string;
    ready = true;
    const retried = await app.inject({
      method: "POST",
      url: `/saas/v1/tenants/${tenantId}/provision`,
      headers: lifecycleHeaders("retry-provision-1"),
    });
    await app.close();

    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({
      tenant: { id: tenantId, status: "active", cellId: "cn-cell-02" },
      job: { type: "tenant.provision", status: "completed" },
    });
    expect(getStoreSnapshot().enterpriseTenants).toHaveLength(1);
  });

  it("tracks lifecycle jobs without faking external completion", async () => {
    seedAccount("owner-user", "owner-token");
    const app = await readyApp();
    const created = await createTenant(app, "Tenant Lifecycle", "create-lifecycle");
    const tenantId = created.json().tenant.id as string;
    const suspended = await lifecycleRequest(app, tenantId, "suspend", "suspend-1");
    const repeated = await lifecycleRequest(app, tenantId, "suspend", "suspend-1");
    const exported = await lifecycleRequest(app, tenantId, "export", "export-1");
    const deleteTenant = await createTenant(
      app,
      "Delete Lifecycle",
      "create-delete-lifecycle",
    );
    const deleted = await lifecycleRequest(
      app,
      deleteTenant.json().tenant.id,
      "delete",
      "delete-1",
    );
    const invalidResuspend = await lifecycleRequest(
      app,
      deleteTenant.json().tenant.id,
      "suspend",
      "suspend-after-delete",
    );
    const jobStatus = await app.inject({
      method: "GET",
      url: `/saas/v1/tenant-jobs/${exported.json().job.id}`,
      headers: auth("owner-token"),
    });
    await app.close();

    expect(suspended.statusCode).toBe(200);
    expect(suspended.json()).toMatchObject({
      tenant: { status: "suspended" },
      job: { type: "tenant.suspend", status: "completed" },
    });
    expect(repeated.json().job.id).toBe(suspended.json().job.id);
    expect(exported.statusCode).toBe(202);
    expect(exported.json().job).toMatchObject({
      type: "tenant.export",
      status: "processing",
    });
    expect(deleted.statusCode).toBe(202);
    expect(deleted.json()).toMatchObject({
      tenant: { status: "deletion_requested" },
      job: { type: "tenant.delete", status: "processing" },
    });
    expect(invalidResuspend.statusCode).toBe(409);
    expect(jobStatus.json().job.id).toBe(exported.json().job.id);
  });

  it("rejects lifecycle operations from another tenant account", async () => {
    seedAccount("owner-user", "owner-token");
    seedAccount("other-user", "other-token");
    const app = await readyApp();
    const created = await createTenant(app, "Protected Tenant", "create-protected");
    const tenantId = created.json().tenant.id as string;
    const denied = await app.inject({
      method: "POST",
      url: `/saas/v1/tenants/${tenantId}/suspend`,
      headers: {
        ...auth("other-token"),
        "idempotency-key": "cross-tenant-suspend",
      },
    });
    await app.close();

    expect(denied.statusCode).toBe(404);
    expect(denied.json().error.code).toBe("tenant_not_found");
    expect(getStoreSnapshot().enterpriseTenants[0]?.status).toBe("active");
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
  action: "suspend" | "export" | "delete",
  idempotencyKey: string,
) {
  return app.inject({
    method: "POST",
    url: `/saas/v1/tenants/${tenantId}/${action}`,
    headers: lifecycleHeaders(idempotencyKey),
  });
}

function lifecycleHeaders(idempotencyKey: string) {
  return { ...auth("owner-token"), "idempotency-key": idempotencyKey };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function readyApp(
  tenantLifecycleExecutor: TenantLifecycleExecutor = {
    async execute() {
      return { status: "processing" };
    },
  },
) {
  return buildApp({
    tenantProvisioner: {
      async provision() {
        return { status: "ready", cellId: "cn-cell-01" } as const;
      },
    },
    tenantLifecycleExecutor,
  });
}
