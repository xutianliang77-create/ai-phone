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

describe("enterprise usage accounting routes", () => {
  beforeEach(seed);

  it("returns tenant aggregates to usage readers", async () => {
    const listUsagePeriodAggregates = vi.fn(async () => ({
      status: "ready" as const,
      aggregates: [aggregate()],
    }));
    const app = await buildApp({
      tenantRouteService: routeService,
      enterpriseRepositoryRuntime: {
        ...legacyEnterpriseRepositoryRuntime,
        listUsagePeriodAggregates,
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/enterprise/v1/usage/aggregates",
      headers: headers("auditor-token"),
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().aggregates[0]).toMatchObject({
      tenantId,
      netAmount: 90,
      ledgerCount: 2,
    });
    expect(listUsagePeriodAggregates).toHaveBeenCalledOnce();
  });

  it("denies members and requires PostgreSQL storage", async () => {
    const app = await buildApp({ tenantRouteService: routeService });
    const denied = await app.inject({
      method: "GET",
      url: "/enterprise/v1/usage/aggregates",
      headers: headers("member-token"),
    });
    const unavailable = await app.inject({
      method: "GET",
      url: "/enterprise/v1/usage/aggregates",
      headers: headers("auditor-token"),
    });
    await app.close();

    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("enterprise_scope_denied");
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe("enterprise_postgres_required");
  });
});

function aggregate() {
  return {
    id: "00000000-0000-4000-8000-000000000071",
    tenantId,
    billingAccountId: tenantId,
    category: "marketing_call_seconds" as const,
    unit: "seconds" as const,
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-08-01T00:00:00.000Z",
    settledAmount: 100,
    adjustmentAmount: -10,
    netAmount: 90,
    settlementCount: 1,
    usageEventCount: 1,
    adjustmentCount: 1,
    ledgerCount: 2,
    ledgerHash: "a".repeat(64),
    sourceWatermark: "2026-07-18T08:00:00.000Z",
    computedAt: "2026-07-18T08:01:00.000Z",
    version: 1,
  };
}

function headers(token: string) {
  const route = routeService.issue({
    tenantId,
    homeRegion: "cn",
    cellId: "cn-cell-01",
    routeEpoch: 1,
  });
  if (route.status !== "ready") throw new Error("route not ready");
  return {
    authorization: `Bearer ${token}`,
    "x-tenant-id": tenantId,
    "x-enterprise-route-document": encodeTenantRouteDocument(route.document),
  };
}

function seed() {
  const store = getStoreSnapshot();
  store.accounts = [];
  store.authSessions = [];
  store.enterpriseTenants = [];
  store.enterpriseMembers = [];
  store.enterpriseTenantJobs = [];
  const now = new Date().toISOString();
  for (const [id, token, role] of [
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
  signingSecret: "enterprise-accounting-route-test-secret-32-bytes",
  publicRoutes: { "cn-cell-01": { homeRegion: "cn",
    apiBaseUrl: "https://api-cn.enterprise.example",
    rtcUrl: "wss://rtc-cn.enterprise.example" } },
});
