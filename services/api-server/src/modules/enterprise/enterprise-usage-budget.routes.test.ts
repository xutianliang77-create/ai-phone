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

describe("enterprise usage budget routes", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.enterpriseTenants = [];
    store.enterpriseMembers = [];
    store.enterpriseTenantJobs = [];
    seed();
  });

  it("allows billing writers to configure and auditors to read budgets", async () => {
    const configureUsageBudget = vi.fn(async (input) => ({
      status: "created" as const,
      budget: budgetRecord(input.context.tenantId),
    }));
    const listUsageBudgets = vi.fn(async () => ({
      status: "ready" as const,
      budgets: [budgetRecord(tenantId)],
    }));
    const app = await buildApp({
      tenantRouteService: routeService,
      enterpriseRepositoryRuntime: {
        ...legacyEnterpriseRepositoryRuntime,
        configureUsageBudget,
        listUsageBudgets,
      },
    });
    const configured = await app.inject({
      method: "PUT",
      url: "/enterprise/v1/usage/budgets/marketing_call_seconds",
      headers: headers("owner-token"),
      payload: budgetBody(),
    });
    const listed = await app.inject({
      method: "GET",
      url: "/enterprise/v1/usage/budgets",
      headers: headers("auditor-token"),
    });
    await app.close();

    expect(configured.statusCode).toBe(201);
    expect(configured.json().budget).toMatchObject({
      category: "marketing_call_seconds",
      limitAmount: 100,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().budgets).toHaveLength(1);
    expect(configureUsageBudget).toHaveBeenCalledOnce();
  });

  it("rejects unprivileged members, tenant spoofing and demo persistence", async () => {
    const app = await buildApp({ tenantRouteService: routeService });
    const denied = await app.inject({
      method: "PUT",
      url: "/enterprise/v1/usage/budgets/marketing_call_seconds",
      headers: headers("member-token"),
      payload: budgetBody(),
    });
    const spoofed = await app.inject({
      method: "PUT",
      url: "/enterprise/v1/usage/budgets/marketing_call_seconds",
      headers: headers("owner-token"),
      payload: { ...budgetBody(), tenantId: "00000000-0000-4000-8000-000000000099" },
    });
    const legacy = await app.inject({
      method: "PUT",
      url: "/enterprise/v1/usage/budgets/marketing_call_seconds",
      headers: headers("owner-token"),
      payload: budgetBody(),
    });
    await app.close();

    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("enterprise_scope_denied");
    expect(spoofed.statusCode).toBe(409);
    expect(spoofed.json().error.code).toBe("tenant_context_mismatch");
    expect(legacy.statusCode).toBe(503);
    expect(legacy.json().error.code).toBe("enterprise_postgres_required");
  });
});

function budgetBody() {
  return {
    unit: "seconds",
    limitAmount: 100,
    alertThresholdPercent: 70,
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-08-01T00:00:00.000Z",
  };
}

function budgetRecord(selectedTenantId: string) {
  return {
    id: "00000000-0000-4000-8000-000000000041",
    tenantId: selectedTenantId,
    category: "marketing_call_seconds" as const,
    unit: "seconds" as const,
    limitAmount: 100,
    alertThresholdPercent: 70,
    status: "active" as const,
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
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
  const now = new Date().toISOString();
  const store = getStoreSnapshot();
  for (const [id, token, role] of [
    ["owner-user", "owner-token", "owner"],
    ["auditor-user", "auditor-token", "auditor"],
    ["member-user", "member-token", "member"],
  ] as const) {
    store.accounts.push({
      id,
      phoneHash: `hash-${id}`,
      phoneMasked: "138****0000",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    store.authSessions.push({
      token,
      userId: id,
      createdAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    store.enterpriseMembers.push({
      id: `${id}-membership`,
      tenantId,
      userId: id,
      role,
      status: "active",
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
  }
  store.enterpriseTenants.push({
    id: tenantId,
    name: "Tenant A",
    status: "active",
    homeRegion: "cn",
    cellId: "cn-cell-01",
    planCode: "enterprise_trial",
    dataRetentionDays: 30,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
}

const routeService = createTenantRouteService({
  signingSecret: "enterprise-usage-route-test-secret-32-bytes",
  publicRoutes: {
    "cn-cell-01": {
      homeRegion: "cn",
      apiBaseUrl: "https://api-cn.enterprise.example",
      rtcUrl: "wss://rtc-cn.enterprise.example",
    },
  },
});
