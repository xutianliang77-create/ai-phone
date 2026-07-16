import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  createEnterpriseAuditCursorService,
} from "./enterprise-audit-cursor.js";
import {
  createTenantRouteService,
  encodeTenantRouteDocument,
} from "./enterprise-tenant-route.js";
import type {
  TenantLifecycleExecutor,
} from "./enterprise-tenant-lifecycle-executor.js";

describe("enterprise audit routes", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.enterpriseTenants = [];
    store.enterpriseMembers = [];
    store.enterpriseTenantJobs = [];
    store.enterpriseAuditEvents = [];
  });

  it("records high-risk results without sensitive request fields", async () => {
    seedAccount("owner-user", "owner-token");
    seedAccount("auditor-user", "auditor-token");
    seedAccount("member-user", "member-token");
    seedAccount("candidate-user", "candidate-token");
    const execute = vi.fn<TenantLifecycleExecutor["execute"]>(
      async ({ job }) => ({
        status: "completed",
        receiptRef: `object:${job.id}`,
        receiptHash: "a".repeat(64),
      }),
    );
    const app = await testApp({ execute });
    const tenantId = await createTenant(app, "owner-token", "Audit Tenant");
    await addMember(app, tenantId, "owner-token", "auditor-user", "auditor");
    await addMember(app, tenantId, "owner-token", "member-user", "member");

    const denied = await app.inject({
      method: "POST",
      url: "/enterprise/v1/members",
      headers: tenantHeaders("member-token", tenantId),
      payload: { userId: "candidate-user", role: "member" },
    });
    const exported = await lifecycleRequest(
      app,
      tenantId,
      "export",
      "audit-export-secret-key",
    );
    const repeated = await lifecycleRequest(
      app,
      tenantId,
      "export",
      "audit-export-secret-key",
    );
    const listed = await auditEvents(app, "auditor-token", tenantId);
    await app.close();

    expect(denied.statusCode).toBe(403);
    expect(exported.statusCode).toBe(200);
    expect(repeated.json().job.id).toBe(exported.json().job.id);
    expect(execute).toHaveBeenCalledOnce();
    expect(listed.statusCode).toBe(200);
    expect(listed.json().events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId,
        actorUserId: "member-user",
        action: "member.create",
        resourceType: "member",
        result: "denied",
        details: { reasonCode: "enterprise_scope_denied", scope: "member:write" },
      }),
      expect.objectContaining({
        tenantId,
        actorUserId: "owner-user",
        action: "tenant.export",
        resourceType: "tenant",
        resourceId: tenantId,
        result: "accepted",
      }),
      expect.objectContaining({
        tenantId,
        actorUserId: "owner-user",
        action: "tenant.export",
        resourceType: "tenant",
        resourceId: tenantId,
        result: "completed",
      }),
    ]));
    expect(listed.json().events.filter(
      (event: { action: string }) => event.action === "tenant.export",
    )).toHaveLength(2);
    const serialized = JSON.stringify(listed.json());
    expect(serialized).not.toContain("audit-export-secret-key");
    expect(serialized).not.toContain("owner-token");
    expect(serialized).not.toContain("138****0000");
  });

  it("enforces audit scope and tenant isolation", async () => {
    seedAccount("owner-a", "token-a");
    seedAccount("owner-b", "token-b");
    seedAccount("member-a", "member-a-token");
    const app = await testApp();
    const tenantA = await createTenant(app, "token-a", "Tenant A");
    const tenantB = await createTenant(app, "token-b", "Tenant B");
    await addMember(app, tenantA, "token-a", "member-a", "member");

    const memberDenied = await auditEvents(app, "member-a-token", tenantA);
    const tenantAEvents = await auditEvents(app, "token-a", tenantA);
    const tenantBEvents = await auditEvents(app, "token-b", tenantB);
    const crossTenant = await auditEvents(app, "token-b", tenantA);
    await app.close();

    expect(memberDenied.statusCode).toBe(403);
    expect(memberDenied.json().error.code).toBe("enterprise_scope_denied");
    expect(tenantAEvents.json().events.length).toBeGreaterThan(0);
    expect(tenantAEvents.json().events.every(
      (event: { tenantId: string }) => event.tenantId === tenantA,
    )).toBe(true);
    expect(tenantBEvents.json().events.every(
      (event: { tenantId: string }) => event.tenantId === tenantB,
    )).toBe(true);
    expect(JSON.stringify(tenantBEvents.json())).not.toContain(tenantA);
    expect(crossTenant.statusCode).toBe(403);
  });

  it("signs pagination cursors and rejects tampering or cross-tenant reuse", async () => {
    seedAccount("owner-a", "token-a");
    seedAccount("owner-b", "token-b");
    seedAccount("candidate-one", "candidate-one-token");
    seedAccount("candidate-two", "candidate-two-token");
    const app = await testApp();
    const tenantA = await createTenant(app, "token-a", "Paged Tenant");
    const tenantB = await createTenant(app, "token-b", "Other Tenant");
    await addMember(app, tenantA, "token-a", "candidate-one", "member");
    await addMember(app, tenantA, "token-a", "candidate-two", "auditor");

    const first = await auditEvents(app, "token-a", tenantA, "?limit=2");
    const nextCursor = first.json().nextCursor as string;
    const second = await auditEvents(
      app,
      "token-a",
      tenantA,
      `?limit=2&cursor=${encodeURIComponent(nextCursor)}`,
    );
    const tampered = await auditEvents(
      app,
      "token-a",
      tenantA,
      `?limit=2&cursor=${encodeURIComponent(`${nextCursor}x`)}`,
    );
    const crossTenant = await auditEvents(
      app,
      "token-b",
      tenantB,
      `?limit=2&cursor=${encodeURIComponent(nextCursor)}`,
    );
    await app.close();

    expect(first.statusCode).toBe(200);
    expect(first.json().events).toHaveLength(2);
    expect(nextCursor).toBeTruthy();
    expect(second.statusCode).toBe(200);
    expect(second.json().events[0]?.id).not.toBe(first.json().events[0]?.id);
    expect(tampered.statusCode).toBe(400);
    expect(tampered.json().error.code).toBe("invalid_audit_cursor");
    expect(crossTenant.statusCode).toBe(400);
    expect(crossTenant.json().error.code).toBe("invalid_audit_cursor");
  });

  it("does not expose audit mutation endpoints", async () => {
    const app = await testApp();
    for (const method of ["POST", "PATCH", "DELETE"] as const) {
      const response = await app.inject({
        method,
        url: "/enterprise/v1/audit-events",
      });
      expect(response.statusCode).toBe(404);
    }
    await app.close();
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

async function createTenant(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  name: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/saas/v1/tenants",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": `create-${token}-${name.replaceAll(" ", "-")}`,
    },
    payload: { name, homeRegion: "cn" },
  });
  expect(response.statusCode).toBe(201);
  return response.json().tenant.id as string;
}

async function addMember(
  app: Awaited<ReturnType<typeof buildApp>>,
  tenantId: string,
  ownerToken: string,
  userId: string,
  role: "member" | "auditor",
) {
  const response = await app.inject({
    method: "POST",
    url: "/enterprise/v1/members",
    headers: tenantHeaders(ownerToken, tenantId),
    payload: { userId, role },
  });
  expect(response.statusCode).toBe(201);
  return response;
}

function lifecycleRequest(
  app: Awaited<ReturnType<typeof buildApp>>,
  tenantId: string,
  action: "export",
  idempotencyKey: string,
) {
  return app.inject({
    method: "POST",
    url: `/saas/v1/tenants/${tenantId}/${action}`,
    headers: {
      authorization: "Bearer owner-token",
      "idempotency-key": idempotencyKey,
    },
  });
}

function auditEvents(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  tenantId: string,
  query = "",
) {
  return app.inject({
    method: "GET",
    url: `/enterprise/v1/audit-events${query}`,
    headers: {
      authorization: `Bearer ${token}`,
      "x-tenant-id": tenantId,
    },
  });
}

function tenantHeaders(token: string, tenantId: string) {
  const route = tenantRouteService.issue({
    tenantId,
    homeRegion: "cn",
    cellId: "cn-cell-01",
  });
  if (route.status !== "ready") throw new Error("Tenant route is not ready");
  return {
    authorization: `Bearer ${token}`,
    "x-tenant-id": tenantId,
    "x-enterprise-route-document": encodeTenantRouteDocument(route.document),
  };
}

function testApp(
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
    tenantRouteService,
    tenantLifecycleExecutor,
    auditCursorService: createEnterpriseAuditCursorService({
      signingSecret: "test-audit-cursor-secret-32-bytes-minimum",
      ttlSeconds: 300,
    }),
  });
}

const tenantRouteService = createTenantRouteService({
  signingSecret: "test-route-signing-secret-32-bytes-minimum",
  publicRoutes: {
    "cn-cell-01": {
      homeRegion: "cn",
      apiBaseUrl: "https://api-cn.enterprise.example",
      rtcUrl: "wss://rtc-cn.enterprise.example",
    },
  },
});
