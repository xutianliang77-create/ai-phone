import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { createEnterpriseProviderReadinessService } from "./enterprise-provider-readiness.js";

describe("enterprise provider readiness", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.enterpriseTenants = [];
    store.enterpriseMembers = [];
    store.enterpriseTenantJobs = [];
    seedTenant();
  });

  it("reports every missing provider as not configured without probing", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const app = await buildApp({
      providerReadinessService: createEnterpriseProviderReadinessService({
        env: {},
        fetcher,
        now: () => Date.parse("2026-07-16T00:00:00Z"),
      }),
    });
    const response = await capabilities(app);
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().capabilities).toHaveLength(5);
    expect(response.json().capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "pstn.outbound", status: "not_configured" }),
      expect.objectContaining({ capability: "crm.sync", status: "not_configured" }),
      expect.objectContaining({ capability: "calendar.meetings", status: "not_configured" }),
      expect.objectContaining({ capability: "channel.messaging", status: "not_configured" }),
      expect.objectContaining({ capability: "screen.ocr", status: "not_configured" }),
    ]));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses live probe responses and never returns probe URLs or credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("pstn")) return probeResponse("ready", {
        outbound: true,
        clearPlayback: false,
      }, "pstn-v2");
      if (url.includes("crm")) return probeResponse("degraded", {
        read: true,
        write: false,
        webhook: true,
      }, "crm-v3");
      if (url.includes("calendar")) {
        return new Response(JSON.stringify({ status: "not_ready" }), { status: 503 });
      }
      return probeResponse("ready", { inbound: true, outbound: true }, "channel-v1");
    });
    const env = configuredEnv();
    const app = await buildApp({
      providerReadinessService: createEnterpriseProviderReadinessService({
        env,
        fetcher,
        now: () => Date.parse("2026-07-16T00:00:00Z"),
      }),
    });
    const response = await capabilities(app);
    await app.close();

    const documents = response.json().capabilities as Record<string, unknown>[];
    expect(documents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "telnyx",
        capability: "pstn.outbound",
        status: "ready",
        features: { outbound: true, inbound: false, clearPlayback: false },
        fingerprint: "pstn-v2",
      }),
      expect.objectContaining({
        provider: "salesforce",
        capability: "crm.sync",
        status: "degraded",
        reasonCode: "provider_degraded",
      }),
      expect.objectContaining({
        capability: "calendar.meetings",
        status: "not_ready",
        reasonCode: "probe_failed",
      }),
      expect.objectContaining({
        capability: "channel.messaging",
        status: "ready",
      }),
    ]));
    expect(documents[0]).toMatchObject({
      region: "cn",
      checkedAt: "2026-07-16T00:00:00.000Z",
      expiresAt: "2026-07-16T00:01:00.000Z",
    });
    const body = JSON.stringify(response.json());
    for (const value of Object.values(env)) {
      if (value?.startsWith("https://") || value?.includes("secret")) {
        expect(body).not.toContain(value);
      }
    }
  });

  it("does not treat mock or incomplete provider configuration as ready", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const app = await buildApp({
      providerReadinessService: createEnterpriseProviderReadinessService({
        env: {
          CALL_PROVIDER_POLICY: "pstn_enabled",
          PSTN_PROVIDER: "mock",
          ENTERPRISE_CRM_PROVIDER: "salesforce",
        },
        fetcher,
      }),
    });
    const response = await capabilities(app);
    await app.close();

    expect(response.json().capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "pstn.outbound",
        status: "not_ready",
        reasonCode: "mock_not_release_ready",
      }),
      expect.objectContaining({
        capability: "crm.sync",
        status: "not_ready",
        reasonCode: "configuration_missing",
      }),
    ]));
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function capabilities(app: Awaited<ReturnType<typeof buildApp>>) {
  return app.inject({
    method: "GET",
    url: "/enterprise/v1/provider-capabilities",
    headers: { authorization: "Bearer token-a", "x-tenant-id": "tenant-a" },
  });
}

function configuredEnv() {
  return {
    CALL_PROVIDER_POLICY: "pstn_enabled",
    PSTN_PROVIDER: "telnyx",
    PSTN_BRIDGE_BASE_URL: "https://pstn-probe.example",
    PSTN_BRIDGE_API_KEY: "pstn-secret",
    ENTERPRISE_CRM_PROVIDER: "salesforce",
    ENTERPRISE_CRM_HEALTH_URL: "https://crm-probe.example/health",
    ENTERPRISE_CRM_API_KEY: "crm-secret",
    ENTERPRISE_CALENDAR_PROVIDER: "google_calendar",
    ENTERPRISE_CALENDAR_HEALTH_URL: "https://calendar-probe.example/health",
    ENTERPRISE_CALENDAR_API_KEY: "calendar-secret",
    ENTERPRISE_CHANNEL_PROVIDER: "whatsapp",
    ENTERPRISE_CHANNEL_HEALTH_URL: "https://channel-probe.example/health",
    ENTERPRISE_CHANNEL_API_KEY: "channel-secret",
  };
}

function probeResponse(
  status: "ready" | "degraded",
  features: Record<string, boolean>,
  fingerprint: string,
) {
  return new Response(JSON.stringify({ status, features, fingerprint }), { status: 200 });
}

function seedTenant() {
  const now = new Date().toISOString();
  const store = getStoreSnapshot();
  store.accounts.push({
    id: "user-a", phoneHash: "hash-user-a", phoneMasked: "138****0000",
    status: "active", createdAt: now, updatedAt: now,
  });
  store.authSessions.push({
    token: "token-a", userId: "user-a", createdAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  store.enterpriseTenants.push({
    id: "tenant-a", name: "Tenant A", status: "active", homeRegion: "cn",
    cellId: "cn-cell-01", planCode: "enterprise_trial", dataRetentionDays: 30,
    createdAt: now, updatedAt: now, version: 1,
  });
  store.enterpriseMembers.push({
    id: "member-a", tenantId: "tenant-a", userId: "user-a", role: "owner",
    status: "active", createdAt: now, updatedAt: now, version: 1,
  });
}
