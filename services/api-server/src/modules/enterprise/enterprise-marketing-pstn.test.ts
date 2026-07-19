import { describe, expect, it, vi } from "vitest";
import { createEnvironmentEnterpriseMarketingPstnProvider } from
  "./enterprise-marketing-pstn-provider.js";
import { marketingPstnIdempotencyKey, marketingPstnIdentity } from
  "./enterprise-marketing-pstn.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const taskId = "00000000-0000-4000-8000-000000000002";

describe("enterprise marketing PSTN dispatch", () => {
  it("derives stable scoped identities and generation-specific provider keys", () => {
    const first = marketingPstnIdentity({ kind: "dispatch", tenantId, taskId,
      generation: 1 });
    expect(first).toBe(marketingPstnIdentity({ kind: "dispatch", tenantId, taskId,
      generation: 1 }));
    expect(first).not.toBe(marketingPstnIdentity({ kind: "dispatch", tenantId, taskId,
      generation: 2 }));
    expect(marketingPstnIdempotencyKey({ tenantId, taskId, generation: 1 }))
      .toBe(`marketing:pstn:${tenantId}:${taskId}:g1`);
  });

  it("fails closed when provider or durable idempotency is unavailable", () => {
    expect(createEnvironmentEnterpriseMarketingPstnProvider({ env: {} }).readiness())
      .toMatchObject({ status: "not_configured", provider: "unavailable" });
    expect(createEnvironmentEnterpriseMarketingPstnProvider({ env: {
      ENTERPRISE_MARKETING_PSTN_PROVIDER: "pstn_http",
      ENTERPRISE_MARKETING_PSTN_BRIDGE_URL: "https://pstn.example.test",
      ENTERPRISE_MARKETING_PSTN_BRIDGE_TOKEN: "b".repeat(32),
      ENTERPRISE_MARKETING_PSTN_WEBHOOK_SECRET: "w".repeat(32),
    } }).readiness()).toMatchObject({ status: "not_ready",
      reasonCode: "provider_idempotency_not_guaranteed" });
  });

  it("forwards one stable idempotency key to a configured bridge", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      status: "in_progress", providerCallId: "provider-call-1",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = createEnvironmentEnterpriseMarketingPstnProvider({ fetcher,
      env: { ENTERPRISE_MARKETING_PSTN_PROVIDER: "pstn_http",
        ENTERPRISE_MARKETING_PSTN_BRIDGE_URL: "https://pstn.example.test",
        ENTERPRISE_MARKETING_PSTN_BRIDGE_TOKEN: "b".repeat(32),
        ENTERPRISE_MARKETING_PSTN_WEBHOOK_SECRET: "w".repeat(32),
        ENTERPRISE_MARKETING_PSTN_IDEMPOTENCY_GUARANTEED: "true" } });
    const idempotencyKey = marketingPstnIdempotencyKey({ tenantId, taskId,
      generation: 1 });
    const result = await provider.dispatch({ idempotencyKey, draftId: taskId,
      callId: "00000000-0000-4000-8000-000000000003", targetPhone: "+14155552671",
      objective: "预约演示", suggestedScript: "预约演示", language: "zh-CN",
      consentPromptVersion: "policy-1", enterpriseAgent: {
        runtimeUrl: "https://agent.example.test/enterprise", ticket: "signed.ticket",
        runId: "00000000-0000-4000-8000-000000000004", disclosureRequired: true,
      }, enterpriseContext: { tenantId,
        taskId, homeRegion: "cn-north", cellId: "cell-a", routeEpoch: 1,
        dispatchGeneration: 1 } });
    expect(result).toEqual({ status: "accepted", providerCallId: "provider-call-1" });
    expect(fetcher).toHaveBeenCalledWith("https://pstn.example.test/agent-calls",
      expect.objectContaining({ headers: expect.objectContaining({
        "idempotency-key": idempotencyKey }) }));
  });
});
