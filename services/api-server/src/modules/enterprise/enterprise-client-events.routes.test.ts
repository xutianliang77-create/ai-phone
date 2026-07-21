import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  createTenantRouteService,
  encodeTenantRouteDocument,
} from "./enterprise-tenant-route.js";

describe("enterprise client telemetry route", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.enterpriseTenants = [];
    store.enterpriseMembers = [];
    store.enterpriseTenantJobs = [];
    seedTenant();
  });

  it("accepts only a signed tenant-scoped redacted event", async () => {
    const app = await buildApp({ tenantRouteService });
    const accepted = await app.inject({
      method: "POST",
      url: "/enterprise/v1/observability/client-events",
      headers: telemetryHeaders(),
      payload: validEvent(),
    });
    const rawDetail = await app.inject({
      method: "POST",
      url: "/enterprise/v1/observability/client-events",
      headers: telemetryHeaders(),
      payload: { ...validEvent(), message: "customer secret" },
    });
    const unsigned = await app.inject({
      method: "POST",
      url: "/enterprise/v1/observability/client-events",
      headers: {
        authorization: "Bearer token-a",
        "x-tenant-id": "tenant-a",
      },
      payload: validEvent(),
    });
    await app.close();

    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toMatchObject({ accepted: true });
    expect(accepted.json().traceId).toBeTruthy();
    expect(rawDetail.statusCode).toBe(400);
    expect(rawDetail.json().error.code).toBe("invalid_enterprise_client_event");
    expect(unsigned.statusCode).toBe(428);
    expect(unsigned.json().error.code).toBe("route_document_required");
  });

  it("rejects cross-tenant route documents and malformed metrics", async () => {
    seedTenant("tenant-b", "user-b", "token-b");
    const app = await buildApp({ tenantRouteService });
    const crossTenant = await app.inject({
      method: "POST",
      url: "/enterprise/v1/observability/client-events",
      headers: {
        ...telemetryHeaders(),
        "x-enterprise-route-document": routeHeader("tenant-b"),
      },
      payload: validEvent(),
    });
    const invalidMetric = await app.inject({
      method: "POST",
      url: "/enterprise/v1/observability/client-events",
      headers: telemetryHeaders(),
      payload: {
        ...validEvent(),
        kind: "performance",
        metricName: "navigation_duration_ms",
        value: -1,
        fingerprint: undefined,
      },
    });
    await app.close();

    expect(crossTenant.statusCode).toBe(409);
    expect(crossTenant.json().error.code).toBe("route_mismatch");
    expect(invalidMetric.statusCode).toBe(400);
  });
});

function validEvent() {
  return {
    kind: "error",
    code: "unexpected_client_error",
    routePath: "/settings",
    appVersion: "0.1.0",
    releaseCommit: "98fbc0a",
    occurredAt: "2026-07-19T00:00:00.000Z",
    fingerprint: "a".repeat(32),
  };
}

function telemetryHeaders() {
  return {
    authorization: "Bearer token-a",
    "x-tenant-id": "tenant-a",
    "x-enterprise-route-document": routeHeader("tenant-a"),
  };
}

function routeHeader(tenantId: string) {
  const route = tenantRouteService.issue({
    tenantId,
    homeRegion: "cn",
    cellId: "cn-cell-01",
    routeEpoch: 1,
  });
  if (route.status !== "ready") throw new Error("Test route is not ready");
  return encodeTenantRouteDocument(route.document);
}

function seedTenant(
  tenantId = "tenant-a",
  userId = "user-a",
  token = "token-a",
) {
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
  store.enterpriseTenants.push({
    id: tenantId,
    name: tenantId,
    status: "active",
    homeRegion: "cn",
    cellId: "cn-cell-01",
    planCode: "enterprise_trial",
    dataRetentionDays: 30,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  store.enterpriseMembers.push({
    id: `member-${tenantId}`,
    tenantId,
    userId,
    role: "owner",
    status: "active",
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
}

const tenantRouteService = createTenantRouteService({
  signingSecret: "test-client-event-route-signing-secret-32-bytes",
  publicRoutes: {
    "cn-cell-01": {
      homeRegion: "cn",
      apiBaseUrl: "https://api-cn.enterprise.example",
      rtcUrl: "wss://rtc-cn.enterprise.example",
    },
  },
});
