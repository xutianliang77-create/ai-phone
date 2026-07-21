import { describe, expect, it, vi } from "vitest";
import { createEnvironmentEnterpriseMarketingHandoffProvider } from
  "./enterprise-marketing-handoff-provider.js";

const request = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  handoffId: "00000000-0000-4000-8000-000000000002",
  dispatchId: "00000000-0000-4000-8000-000000000003",
  communicationSessionId: "00000000-0000-4000-8000-000000000004",
  supportSessionId: "00000000-0000-4000-8000-000000000005",
  claimId: "00000000-0000-4000-8000-000000000006",
  agentUserId: "user-1", requestedAt: "2026-07-20T00:00:00.000Z",
  idempotencyKey: "marketing-handoff:test",
};

describe("enterprise marketing handoff provider", () => {
  it("fails closed until all provider guarantees are configured", async () => {
    const provider = createEnvironmentEnterpriseMarketingHandoffProvider({ env: {} });
    expect(provider.readiness()).toEqual({ status: "not_configured",
      reasonCode: "marketing_handoff_provider_not_configured",
      aiStopDeadlineMs: 300 });
    await expect(provider.activate(request)).resolves.toMatchObject({
      status: "not_configured",
    });
  });

  it("accepts only a complete <=300ms stop and operator join receipt", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "completed", receiptId: "receipt-1", stopLatencyMs: 287,
      aiAudioStoppedAt: "2026-07-20T00:00:00.287Z",
      operatorJoinedAt: "2026-07-20T00:00:00.290Z",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = createEnvironmentEnterpriseMarketingHandoffProvider({
      env: configured(), fetcher,
    });
    expect(provider.readiness()).toMatchObject({ status: "ready",
      provider: "pstn_http", aiStopDeadlineMs: 300 });
    await expect(provider.activate(request)).resolves.toMatchObject({
      status: "completed",
      aiAudioStoppedAt: "2026-07-20T00:00:00.287Z",
      operatorJoinedAt: "2026-07-20T00:00:00.290Z",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://handoff.example.test/marketing-handoffs/activate",
      expect.objectContaining({ method: "POST",
        headers: expect.objectContaining({
          "idempotency-key": request.idempotencyKey,
        }) }),
    );
  });

  it("rejects a provider receipt outside the stop deadline", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "completed", receiptId: "receipt-2", stopLatencyMs: 301,
      aiAudioStoppedAt: "2026-07-20T00:00:00.301Z",
      operatorJoinedAt: "2026-07-20T00:00:00.302Z",
    }), { status: 200 }));
    const provider = createEnvironmentEnterpriseMarketingHandoffProvider({
      env: configured(), fetcher,
    });
    await expect(provider.activate(request)).resolves.toEqual({
      status: "failed", reasonCode: "marketing_handoff_invalid_receipt",
    });
  });
});

function configured(): NodeJS.ProcessEnv {
  return { ENTERPRISE_MARKETING_HANDOFF_PROVIDER: "pstn_http",
    ENTERPRISE_MARKETING_HANDOFF_BRIDGE_URL: "https://handoff.example.test",
    ENTERPRISE_MARKETING_HANDOFF_BRIDGE_TOKEN: "t".repeat(32),
    ENTERPRISE_MARKETING_HANDOFF_IDEMPOTENCY_GUARANTEED: "true",
    ENTERPRISE_MARKETING_HANDOFF_OPERATOR_JOIN_GUARANTEED: "true",
    ENTERPRISE_MARKETING_HANDOFF_AI_STOP_GUARANTEE_MS: "300" };
}
