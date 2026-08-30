import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { legacyEnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { signEnterpriseBillingLifecycleRequest,
  type EnterpriseBillingLifecycleWebhookBody } from
  "./enterprise-billing-lifecycle-auth.js";
import { createTenantRouteService, encodeTenantRouteDocument } from
  "./enterprise-tenant-route.js";

const secret = "billing-lifecycle-secret-01234567890123456789";
const tenantId = "00000000-0000-4000-8000-000000000001";
const subscriptionId = "00000000-0000-4000-8000-000000000002";
const keys = ["ENTERPRISE_BILLING_LIFECYCLE_PROVIDER",
  "ENTERPRISE_BILLING_LIFECYCLE_SIGNING_SECRET",
  "ENTERPRISE_BILLING_LIFECYCLE_REPLAY_SECONDS"] as const;
let previous: Record<string, string | undefined>;

describe("enterprise billing lifecycle routes", () => {
  beforeEach(() => {
    previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    process.env.ENTERPRISE_BILLING_LIFECYCLE_PROVIDER = "billing-adapter";
    process.env.ENTERPRISE_BILLING_LIFECYCLE_SIGNING_SECRET = secret;
    process.env.ENTERPRISE_BILLING_LIFECYCLE_REPLAY_SECONDS = "300";
    seedTenant();
  });
  afterEach(() => {
    for (const key of keys) previous[key] === undefined
      ? delete process.env[key] : process.env[key] = previous[key];
  });

  it("queues a verified event under the signed tenant context", async () => {
    const ingest = vi.fn(async () => ({
      status: "queued" as const,
      command: { id: subscriptionId, tenantId, eventId: subscriptionId,
        status: "pending" as const, dueAt: new Date().toISOString(), attempts: 0,
        leaseGeneration: 0, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), version: 1 },
    }));
    const app = await buildApp({ enterpriseRepositoryRuntime: {
      ...legacyEnterpriseRepositoryRuntime,
      driver: "postgres",
      ingestBillingLifecycleEvent: ingest,
    } });
    const now = new Date();
    const body = eventBody(now);
    const timestamp = String(Math.floor(now.getTime() / 1_000));
    const response = await app.inject({
      method: "POST",
      url: "/internal/enterprise/billing/subscription-events",
      headers: {
        "x-enterprise-billing-timestamp": timestamp,
        "x-enterprise-billing-signature":
          signEnterpriseBillingLifecycleRequest({ body, timestamp, secret }),
      },
      payload: body,
    });
    await app.close();
    expect(response.statusCode).toBe(202);
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ tenantId,
        actorUserId: "system:enterprise-billing-lifecycle" }),
      event: expect.objectContaining({ subscriptionId,
        providerPayloadHash: "a".repeat(64) }),
    }));
  });

  it("rejects an invalid signature before repository access", async () => {
    const ingest = vi.fn();
    const app = await buildApp({ enterpriseRepositoryRuntime: {
      ...legacyEnterpriseRepositoryRuntime,
      driver: "postgres",
      ingestBillingLifecycleEvent: ingest,
    } });
    const now = new Date();
    const response = await app.inject({ method: "POST",
      url: "/internal/enterprise/billing/subscription-events",
      headers: { "x-enterprise-billing-timestamp":
        String(Math.floor(now.getTime() / 1_000)),
        "x-enterprise-billing-signature": `sha256:${"0".repeat(64)}` },
      payload: eventBody(now) });
    await app.close();
    expect(response.statusCode).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("returns only tenant-scoped lifecycle truth to a billing reader", async () => {
    const getStatus = vi.fn(async () => ({ status: "ready" as const,
      lifecycle: { accountStatus: "past_due" as const, subscriptionId,
        subscriptionStatus: "past_due" as const,
        currentPeriodStart: "2026-08-01T00:00:00.000Z",
        currentPeriodEnd: "2026-09-01T00:00:00.000Z",
        lastEventType: "payment_failed" as const,
        lastDecisionAction: "applied" as const,
        lastDecisionReason: "payment_failed",
        updatedAt: "2026-08-31T00:00:00.000Z" } }));
    const app = await buildApp({ tenantRouteService: routeService,
      enterpriseRepositoryRuntime: { ...legacyEnterpriseRepositoryRuntime,
        getBillingLifecycleStatus: getStatus } });
    const response = await app.inject({ method: "GET",
      url: `/saas/v1/tenants/${tenantId}/subscription/lifecycle`,
      headers: tenantHeaders() });
    await app.close();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ accountStatus: "past_due",
      subscriptionStatus: "past_due", lastEventType: "payment_failed" });
    expect(response.json()).not.toHaveProperty("providerPayload");
    expect(getStatus).toHaveBeenCalledWith(expect.objectContaining({ context:
      expect.objectContaining({ tenantId, actorUserId: "auditor-user" }) }));
  });
});

function eventBody(now: Date): EnterpriseBillingLifecycleWebhookBody {
  return { tenantId, provider: "billing-adapter", providerEventId: "event-1",
    subscriptionId, eventType: "payment_failed",
    providerPayloadHash: "a".repeat(64), occurredAt: now.toISOString(),
    effectiveAt: now.toISOString() };
}

const routeService = createTenantRouteService({
  signingSecret: "enterprise-billing-lifecycle-route-secret-32-bytes",
  publicRoutes: { "cn-cell-01": { homeRegion: "cn",
    apiBaseUrl: "https://api-cn.enterprise.example",
    rtcUrl: "wss://rtc-cn.enterprise.example" } },
});
function tenantHeaders() {
  const route = routeService.issue({ tenantId, homeRegion: "cn",
    cellId: "cn-cell-01", routeEpoch: 1 });
  if (route.status !== "ready") throw new Error("route not ready");
  return { authorization: "Bearer auditor-token", "x-tenant-id": tenantId,
    "x-enterprise-route-document": encodeTenantRouteDocument(route.document) };
}
function seedTenant() {
  const store = getStoreSnapshot();
  store.accounts = []; store.authSessions = []; store.enterpriseTenants = [];
  store.enterpriseMembers = []; store.enterpriseTenantJobs = [];
  const now = new Date().toISOString();
  store.accounts.push({ id: "auditor-user", phoneHash: "hash-auditor",
    phoneMasked: "138****0000", status: "active", createdAt: now, updatedAt: now });
  store.authSessions.push({ token: "auditor-token", userId: "auditor-user",
    createdAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  store.enterpriseTenants.push({ id: tenantId, name: "Tenant A", status: "active",
    homeRegion: "cn", cellId: "cn-cell-01", planCode: "enterprise_trial",
    dataRetentionDays: 30, createdAt: now, updatedAt: now, version: 1 });
  store.enterpriseMembers.push({ id: "auditor-member", tenantId,
    userId: "auditor-user", role: "auditor", status: "active",
    createdAt: now, updatedAt: now, version: 1 });
}
