import { describe, expect, it, vi } from "vitest";
import { createEnterpriseApi, EnterpriseApiError } from "./enterprise-api.js";

describe("enterprise API client", () => {
  it("sends the bearer token and selected tenant", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        tenant: { id: "tenant-a" },
        member: { role: "owner" },
        scopes: ["tenant:read"],
      }),
      { status: 200 },
    ));
    const api = createEnterpriseApi(fetcher, "https://enterprise.example/api/");

    await api.getContext("token-a", "tenant-a");

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://enterprise.example/api/enterprise/v1/me",
    );
    const request = fetcher.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({
      authorization: "Bearer token-a",
      "x-tenant-id": "tenant-a",
    });
  });

  it("preserves the server error code for actionable login failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: "invalid_code", message: "Phone login failed" } }),
      { status: 401 },
    ));
    const api = createEnterpriseApi(fetcher, "/api");

    await expect(api.login("13800138000", "000000")).rejects.toMatchObject({
      status: 401,
      code: "invalid_code",
    } satisfies Partial<EnterpriseApiError>);
  });

  it("loads the signed route document from the SaaS control plane", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ tenantId: "tenant-a", signature: "signed" }),
      { status: 200 },
    ));
    const api = createEnterpriseApi(fetcher, "/api");

    await api.getTenantRoute("token-a", "tenant-a");

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/saas/v1/tenants/tenant-a/route",
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer token-a",
    });
  });

  it("loads provider capabilities and tenant jobs with tenant authentication", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(
      JSON.stringify({ capabilities: [], job: { id: "job-a" } }),
      { status: 200 },
    ));
    const api = createEnterpriseApi(fetcher, "/api");

    await api.getProviderCapabilities("token-a", "tenant-a");
    await api.getTenantJob("token-a", "job-a");

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/enterprise/v1/provider-capabilities",
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer token-a",
      "x-tenant-id": "tenant-a",
    });
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/saas/v1/tenant-jobs/job-a");
  });

  it("binds enterprise content reads to the tenant and signed route document", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(
      JSON.stringify({ sources: [], termPacks: [], scriptTemplates: [] }),
      { status: 200 },
    ));
    const api = createEnterpriseApi(fetcher, "/api");
    const context = contentContext();

    await api.listKnowledgeSources(context);
    await api.listTermPacks(context);
    await api.listScriptTemplates(context);

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/enterprise/v1/knowledge/sources",
      "/api/enterprise/v1/terminology/packs",
      "/api/enterprise/v1/script-templates",
    ]);
    for (const call of fetcher.mock.calls) {
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers).toMatchObject({
        authorization: "Bearer token-a",
        "x-tenant-id": "tenant-a",
      });
      expect(decodeRouteDocument(headers["x-enterprise-route-document"]!))
        .toEqual(context.routeDocument);
    }
  });

  it("uses exact version, review and publish endpoints without a body tenant override", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(
      JSON.stringify({ knowledgeVersion: {}, termPackVersion: {}, scriptTemplateVersion: {} }),
      { status: 200 },
    ));
    const api = createEnterpriseApi(fetcher, "/api");
    const context = contentContext();

    await api.stageKnowledgeVersion(context, "knowledge-version", {
      expectedVersion: 2,
      chunks: [{ blockId: "block-001", content: "verified content" }],
    });
    await api.publishTermPackVersion(context, "term-version", {
      expectedVersion: 3,
      effectiveFrom: "2026-07-19T00:00:00.000Z",
    });
    await api.createScriptTemplateVersion(context, "template-a", {
      locale: "zh-CN", countryCode: "CN", productCode: "product-cn",
    });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/enterprise/v1/knowledge/versions/knowledge-version/chunks",
      "/api/enterprise/v1/terminology/pack-versions/term-version/publish",
      "/api/enterprise/v1/script-templates/template-a/versions",
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      expectedVersion: 2,
      chunks: [{ blockId: "block-001", content: "verified content" }],
    });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).not.toHaveProperty("tenantId");
  });

  it("binds member reads and writes to the selected tenant route without a body tenant override", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(
      JSON.stringify({ members: [], member: { id: "member-b" } }),
      { status: 200 },
    ));
    const api = createEnterpriseApi(fetcher, "/api");
    const context = contentContext();

    await api.listMembers(context);
    await api.createMember(context, { userId: "user-b", role: "support_agent" });
    await api.updateMember(context, "member/b", {
      role: "support_manager",
      status: "suspended",
    });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/enterprise/v1/members",
      "/api/enterprise/v1/members",
      "/api/enterprise/v1/members/member%2Fb",
    ]);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual([
      undefined,
      "POST",
      "PATCH",
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      userId: "user-b",
      role: "support_agent",
    });
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({
      role: "support_manager",
      status: "suspended",
    });
    for (const call of fetcher.mock.calls) {
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers).toMatchObject({
        authorization: "Bearer token-a",
        "x-tenant-id": "tenant-a",
      });
      expect(decodeRouteDocument(headers["x-enterprise-route-document"]!))
        .toEqual(context.routeDocument);
    }
  });

  it("uses exact billing, budget and usage routes with the signed tenant context", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(
      JSON.stringify({ account: {}, subscription: {}, entitlement: {}, budgets: [], budget: {}, aggregates: [] }),
      { status: 200 },
    ));
    const api = createEnterpriseApi(fetcher, "/api");
    const context = contentContext();

    await api.getBillingEntitlements(context);
    await api.changeSubscription(context, {
      planCode: "enterprise_growth",
      planVersion: "2026-07",
      seats: 12,
      billingCycle: "annual",
      idempotencyKey: "change-a",
    });
    await api.listUsageBudgets(context);
    await api.configureUsageBudget(context, "llm_input_tokens", {
      unit: "tokens",
      limitAmount: 1000,
      alertThresholdPercent: 80,
      periodStart: "2026-07-01T00:00:00Z",
      periodEnd: "2026-08-01T00:00:00Z",
      expectedVersion: 2,
    });
    await api.listUsageAggregates(context);

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/saas/v1/tenants/tenant-a/entitlements",
      "/api/saas/v1/tenants/tenant-a/subscription/change",
      "/api/enterprise/v1/usage/budgets",
      "/api/enterprise/v1/usage/budgets/llm_input_tokens",
      "/api/enterprise/v1/usage/aggregates",
    ]);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual([
      undefined, "POST", undefined, "PUT", undefined,
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      planCode: "enterprise_growth",
      planVersion: "2026-07",
      seats: 12,
      billingCycle: "annual",
      idempotencyKey: "change-a",
    });
    expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body))).not.toHaveProperty("tenantId");
    for (const call of fetcher.mock.calls) {
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers["x-tenant-id"]).toBe("tenant-a");
      expect(decodeRouteDocument(headers["x-enterprise-route-document"]!))
        .toEqual(context.routeDocument);
    }
  });
});

function contentContext() {
  return {
    token: "token-a",
    tenantId: "tenant-a",
    routeDocument: {
      tenantId: "tenant-a",
      homeRegion: "cn",
      cellId: "cn-cell-01",
      routeEpoch: 7,
      apiBaseUrl: "https://api-cn.enterprise.example",
      rtcUrl: "wss://rtc-cn.enterprise.example",
      issuedAt: "2026-07-19T00:00:00.000Z",
      expiresAt: "2099-07-19T00:05:00.000Z",
      signature: "signed-route-document",
    },
  };
}

function decodeRouteDocument(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - value.length % 4) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as unknown;
}
