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
});
