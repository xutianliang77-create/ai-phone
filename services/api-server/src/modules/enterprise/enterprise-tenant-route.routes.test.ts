import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  createTenantRouteService,
  encodeTenantRouteDocument,
} from "./enterprise-tenant-route.js";

const signingSecret = "test-route-signing-secret-32-bytes-minimum";

describe("enterprise tenant route document", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.enterpriseTenants = [];
    store.enterpriseMembers = [];
    store.enterpriseTenantJobs = [];
    seedTenant("tenant-a", "user-a", "token-a", "cn", "cn-cell-01");
    seedAccount("candidate-user", "candidate-token");
  });

  it("issues a short-lived signed document for an active membership", async () => {
    const routeService = testRouteService(() => Date.parse("2026-07-16T00:00:00Z"));
    const app = await buildApp({ tenantRouteService: routeService });
    const response = await app.inject({
      method: "GET",
      url: "/saas/v1/tenants/tenant-a/route",
      headers: auth("token-a"),
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tenantId: "tenant-a",
      homeRegion: "cn",
      cellId: "cn-cell-01",
      routeEpoch: 1,
      apiBaseUrl: "https://api-cn.enterprise.example",
      rtcUrl: "wss://rtc-cn.enterprise.example",
      issuedAt: "2026-07-16T00:00:00.000Z",
      expiresAt: "2026-07-16T00:01:00.000Z",
    });
    expect(response.json().signature).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(JSON.stringify(response.json())).not.toContain("provider");
    expect(routeService.verify(response.json(), tenantRoute())).toEqual({
      status: "verified",
    });
    expect(routeService.verify(response.json(), {
      ...tenantRoute(),
      routeEpoch: 2,
    })).toEqual({ status: "mismatch" });
  });

  it("rejects missing, tampered, expired, and wrong-tenant documents on writes", async () => {
    let now = Date.parse("2026-07-16T00:00:00Z");
    const routeService = testRouteService(() => now);
    const issued = routeService.issue(tenantRoute());
    if (issued.status !== "ready") throw new Error("Route fixture is not ready");
    const app = await buildApp({ tenantRouteService: routeService });

    const missing = await addMember(app, undefined, "candidate-user");
    const tampered = await addMember(app, encodeTenantRouteDocument({
      ...issued.document,
      cellId: "cn-cell-02",
    }), "candidate-user");
    const staleEpoch = await addMember(app, encodeTenantRouteDocument({
      ...issued.document,
      routeEpoch: issued.document.routeEpoch - 1,
    }), "candidate-user");
    const otherIssued = routeService.issue({
      tenantId: "tenant-b",
      homeRegion: "cn",
      cellId: "cn-cell-01",
      routeEpoch: 1,
    });
    if (otherIssued.status !== "ready") throw new Error("Other route fixture is not ready");
    const wrongTenant = await addMember(
      app,
      encodeTenantRouteDocument(otherIssued.document),
      "candidate-user",
    );
    now += 61_000;
    const expired = await addMember(
      app,
      encodeTenantRouteDocument(issued.document),
      "candidate-user",
    );
    await app.close();

    expect(missing.statusCode).toBe(428);
    expect(missing.json().error.code).toBe("route_document_required");
    expect(tampered.statusCode).toBe(409);
    expect(tampered.json().error.code).toBe("route_document_invalid");
    expect(staleEpoch.statusCode).toBe(409);
    expect(staleEpoch.json().error.code).toBe("route_document_invalid");
    expect(wrongTenant.statusCode).toBe(409);
    expect(wrongTenant.json().error.code).toBe("route_mismatch");
    expect(expired.statusCode).toBe(409);
    expect(expired.json().error.code).toBe("route_document_expired");
    expect(getStoreSnapshot().enterpriseMembers).toHaveLength(1);
  });

  it("reports not ready instead of inventing public endpoints", async () => {
    const app = await buildApp({
      tenantRouteService: createTenantRouteService({
        signingSecret: undefined,
        publicRoutes: {},
      }),
    });
    const response = await app.inject({
      method: "GET",
      url: "/saas/v1/tenants/tenant-a/route",
      headers: auth("token-a"),
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("route_not_ready");
  });
});

function testRouteService(now: () => number) {
  return createTenantRouteService({
    signingSecret,
    publicRoutes: {
      "cn-cell-01": {
        homeRegion: "cn",
        apiBaseUrl: "https://api-cn.enterprise.example",
        rtcUrl: "wss://rtc-cn.enterprise.example",
      },
    },
    ttlSeconds: 60,
    now,
  });
}

function tenantRoute() {
  return {
    tenantId: "tenant-a",
    homeRegion: "cn",
    cellId: "cn-cell-01",
    routeEpoch: 1,
  };
}

function addMember(
  app: Awaited<ReturnType<typeof buildApp>>,
  encodedRoute: string | undefined,
  userId: string,
) {
  return app.inject({
    method: "POST",
    url: "/enterprise/v1/members",
    headers: {
      ...auth("token-a"),
      "x-tenant-id": "tenant-a",
      ...(encodedRoute ? { "x-enterprise-route-document": encodedRoute } : {}),
    },
    payload: { userId, role: "member" },
  });
}

function seedTenant(
  tenantId: string,
  userId: string,
  token: string,
  homeRegion: string,
  cellId: string,
) {
  seedAccount(userId, token);
  const now = new Date().toISOString();
  const store = getStoreSnapshot();
  store.enterpriseTenants.push({
    id: tenantId, name: "Tenant A", status: "active", homeRegion, cellId,
    planCode: "enterprise_trial", dataRetentionDays: 30,
    createdAt: now, updatedAt: now, version: 1,
  });
  store.enterpriseMembers.push({
    id: `member-${tenantId}`, tenantId, userId, role: "owner", status: "active",
    createdAt: now, updatedAt: now, version: 1,
  });
}

function seedAccount(userId: string, token: string) {
  const now = new Date().toISOString();
  const store = getStoreSnapshot();
  store.accounts.push({
    id: userId, phoneHash: `hash-${userId}`, phoneMasked: "138****0000",
    status: "active", createdAt: now, updatedAt: now,
  });
  store.authSessions.push({
    token, userId, createdAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}
