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

describe("enterprise communication policy routes", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.enterpriseTenants = [];
    store.enterpriseMembers = [];
    store.enterpriseTenantJobs = [];
    seed();
  });

  it("allows only tenant writers to publish an immutable policy version", async () => {
    const publishCommunicationPolicy = vi.fn(async (input) => ({
      status: "created" as const,
      id: input.policy.id,
    }));
    const app = await buildApp({
      tenantRouteService: routeService,
      enterpriseRepositoryRuntime: {
        ...legacyEnterpriseRepositoryRuntime,
        publishCommunicationPolicy,
      },
    });
    const owner = await app.inject({
      method: "POST",
      url: "/enterprise/v1/communication-policies",
      headers: headers("owner-token"),
      payload: policyBody(),
    });
    const member = await app.inject({
      method: "POST",
      url: "/enterprise/v1/communication-policies",
      headers: headers("member-token"),
      payload: policyBody(),
    });
    await app.close();

    expect(owner.statusCode).toBe(201);
    expect(owner.json().policy).toMatchObject({
      policyVersion: "policy-1",
      status: "published",
    });
    expect(publishCommunicationPolicy).toHaveBeenCalledOnce();
    expect(publishCommunicationPolicy.mock.calls[0]?.[0]).toMatchObject({
      context: { tenantId: "00000000-0000-4000-8000-000000000001" },
      policy: {
        policyVersion: "policy-1",
        recordingMode: "consent_required",
      },
    });
    expect(member.statusCode).toBe(403);
    expect(member.json().error.code).toBe("enterprise_scope_denied");
  });

  it("rejects tenant spoofing and demo-only persistence", async () => {
    const app = await buildApp({ tenantRouteService: routeService });
    const spoofed = await app.inject({
      method: "POST",
      url: "/enterprise/v1/communication-policies",
      headers: headers("owner-token"),
      payload: { ...policyBody(), tenantId: "00000000-0000-4000-8000-000000000099" },
    });
    const legacy = await app.inject({
      method: "POST",
      url: "/enterprise/v1/communication-policies",
      headers: headers("owner-token"),
      payload: policyBody(),
    });
    await app.close();

    expect(spoofed.statusCode).toBe(409);
    expect(spoofed.json().error.code).toBe("tenant_context_mismatch");
    expect(legacy.statusCode).toBe(503);
    expect(legacy.json().error.code).toBe("enterprise_postgres_required");
  });
});

function policyBody() {
  return {
    policyVersion: "policy-1",
    asrPreference: "prefer_device",
    translationPreference: "prefer_cloud",
    ttsPreference: "prefer_cloud",
    voiceIdentityMode: "consent_required",
    recordingMode: "consent_required",
    diagnosticAudioMode: "consent_required",
    allowCaptionsOnly: true,
    allowHalfDuplex: false,
  };
}

function headers(token: string) {
  const route = routeService.issue({
    tenantId: "00000000-0000-4000-8000-000000000001",
    homeRegion: "cn",
    cellId: "cn-cell-01",
    routeEpoch: 1,
  });
  if (route.status !== "ready") throw new Error("route not ready");
  return {
    authorization: `Bearer ${token}`,
    "x-tenant-id": "00000000-0000-4000-8000-000000000001",
    "x-enterprise-route-document": encodeTenantRouteDocument(route.document),
  };
}

function seed() {
  const now = new Date().toISOString();
  const store = getStoreSnapshot();
  for (const [id, token, role] of [
    ["owner-user", "owner-token", "owner"],
    ["member-user", "member-token", "member"],
  ] as const) {
    store.accounts.push({
      id, phoneHash: `hash-${id}`, phoneMasked: "138****0000",
      status: "active", createdAt: now, updatedAt: now,
    });
    store.authSessions.push({
      token, userId: id, createdAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    store.enterpriseMembers.push({
      id: `${id}-membership`,
      tenantId: "00000000-0000-4000-8000-000000000001",
      userId: id,
      role,
      status: "active",
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
  }
  store.enterpriseTenants.push({
    id: "00000000-0000-4000-8000-000000000001",
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
  signingSecret: "enterprise-policy-route-test-secret-32-bytes",
  publicRoutes: {
    "cn-cell-01": {
      homeRegion: "cn",
      apiBaseUrl: "https://api-cn.enterprise.example",
      rtcUrl: "wss://rtc-cn.enterprise.example",
    },
  },
});
