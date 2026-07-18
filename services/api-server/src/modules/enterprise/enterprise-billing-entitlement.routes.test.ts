import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  legacyEnterpriseRepositoryRuntime,
} from "./enterprise-repository-runtime.js";
import {
  createTenantRouteService,
  encodeTenantRouteDocument,
} from "./enterprise-tenant-route.js";

const tenantId = "00000000-0000-4000-8000-000000000001";

describe("enterprise billing entitlement routes", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.enterpriseTenants = [];
    store.enterpriseMembers = [];
    store.enterpriseTenantJobs = [];
    seed();
  });

  it("returns server entitlement truth and allows only billing writers to change plans", async () => {
    const getBillingEntitlements = vi.fn(async () => ({
      status: "ready" as const,
      state: state(),
    }));
    const changeSubscription = vi.fn(async () => ({
      status: "changed" as const,
      ...state("enterprise-standard", "standard-2026-07"),
    }));
    const app = await buildApp({
      tenantRouteService: routeService,
      enterpriseRepositoryRuntime: {
        ...legacyEnterpriseRepositoryRuntime,
        getBillingEntitlements,
        changeSubscription,
      },
    });
    const read = await app.inject({
      method: "GET",
      url: `/saas/v1/tenants/${tenantId}/entitlements`,
      headers: headers("auditor-token"),
    });
    const changed = await app.inject({
      method: "POST",
      url: `/saas/v1/tenants/${tenantId}/subscription/change`,
      headers: headers("owner-token"),
      payload: changeBody(),
    });
    const denied = await app.inject({
      method: "POST",
      url: `/saas/v1/tenants/${tenantId}/subscription/change`,
      headers: headers("member-token"),
      payload: changeBody(),
    });
    await app.close();

    expect(read.statusCode).toBe(200);
    expect(read.json().entitlement.entitlements).toEqual(
      state().entitlement.entitlements,
    );
    expect(changed.statusCode).toBe(201);
    expect(changeSubscription.mock.calls[0]?.[0].change).toMatchObject({
      planCode: "enterprise-standard",
      seats: 5,
    });
    expect(denied.statusCode).toBe(403);
  });

  it("rejects cross-tenant paths, spoofed bodies and demo persistence", async () => {
    const app = await buildApp({ tenantRouteService: routeService });
    const wrongPath = await app.inject({
      method: "GET",
      url: "/saas/v1/tenants/00000000-0000-4000-8000-000000000099/entitlements",
      headers: headers("owner-token"),
    });
    const spoofed = await app.inject({
      method: "POST",
      url: `/saas/v1/tenants/${tenantId}/subscription/change`,
      headers: headers("owner-token"),
      payload: { ...changeBody(), tenantId: "00000000-0000-4000-8000-000000000099" },
    });
    const legacy = await app.inject({
      method: "POST",
      url: `/saas/v1/tenants/${tenantId}/subscription/change`,
      headers: headers("owner-token"),
      payload: changeBody(),
    });
    await app.close();

    expect(wrongPath.statusCode).toBe(409);
    expect(spoofed.statusCode).toBe(409);
    expect(legacy.statusCode).toBe(503);
    expect(legacy.json().error.code).toBe("enterprise_postgres_required");
  });
});

function changeBody() {
  return {
    planCode: "enterprise-standard",
    planVersion: "standard-2026-07",
    seats: 5,
    billingCycle: "monthly",
    idempotencyKey: "subscription-change-1",
  };
}

function state(planCode = "enterprise-trial", planVersion = "trial-1") {
  const account = {
    id: "00000000-0000-4000-8000-000000000061",
    tenantId,
    status: "active" as const,
    currency: "CNY",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    version: 1,
  };
  const subscription = {
    id: "00000000-0000-4000-8000-000000000062",
    tenantId,
    billingAccountId: account.id,
    planCode,
    planVersion,
    status: "active",
    seats: 5,
    billingCycle: "monthly",
    createdAt: "2026-07-18T09:00:00.000Z",
    updatedAt: "2026-07-18T09:00:00.000Z",
    version: 1,
  };
  return {
    account,
    subscription,
    entitlement: {
      id: "00000000-0000-4000-8000-000000000063",
      tenantId,
      billingAccountId: account.id,
      subscriptionId: subscription.id,
      entitlementVersion: "entitlement-current",
      status: "active" as const,
      planCode,
      planVersion,
      entitlements: {
        "worker.translation_runtime.concurrent": { enabled: true, limit: 8 },
      },
      effectiveFrom: "2026-07-18T09:00:00.000Z",
      createdAt: "2026-07-18T09:00:00.000Z",
    },
  };
}

function headers(token: string) {
  const route = routeService.issue({ tenantId, homeRegion: "cn",
    cellId: "cn-cell-01", routeEpoch: 1 });
  if (route.status !== "ready") throw new Error("route not ready");
  return {
    authorization: `Bearer ${token}`,
    "x-tenant-id": tenantId,
    "x-enterprise-route-document": encodeTenantRouteDocument(route.document),
  };
}

function seed() {
  const now = new Date().toISOString();
  const store = getStoreSnapshot();
  for (const [id, token, role] of [
    ["owner-user", "owner-token", "owner"],
    ["auditor-user", "auditor-token", "auditor"],
    ["member-user", "member-token", "member"],
  ] as const) {
    store.accounts.push({ id, phoneHash: `hash-${id}`, phoneMasked: "138****0000",
      status: "active", createdAt: now, updatedAt: now });
    store.authSessions.push({ token, userId: id, createdAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString() });
    store.enterpriseMembers.push({ id: `${id}-membership`, tenantId, userId: id,
      role, status: "active", createdAt: now, updatedAt: now, version: 1 });
  }
  store.enterpriseTenants.push({ id: tenantId, name: "Tenant A", status: "active",
    homeRegion: "cn", cellId: "cn-cell-01", planCode: "enterprise_trial",
    dataRetentionDays: 30, createdAt: now, updatedAt: now, version: 1 });
}

const routeService = createTenantRouteService({
  signingSecret: "enterprise-billing-route-test-secret-32-bytes",
  publicRoutes: { "cn-cell-01": { homeRegion: "cn",
    apiBaseUrl: "https://api-cn.enterprise.example",
    rtcUrl: "wss://rtc-cn.enterprise.example" } },
});
