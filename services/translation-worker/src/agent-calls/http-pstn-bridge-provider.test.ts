import { describe, expect, it } from "vitest";
import { HttpPstnBridgeProvider } from "./http-pstn-bridge-provider.js";

describe("HttpPstnBridgeProvider", () => {
  it("submits agent call scripts to the PSTN bridge", async () => {
    const requests = [];
    const provider = new HttpPstnBridgeProvider({
      baseUrl: "https://pstn-bridge.qkxy.cn/",
      apiKey: "bridge-secret",
      timeoutMs: 100,
      fetchFn: (async (url: string, init?: RequestInit) => {
        requests.push({
          url,
          authorization: header(init, "authorization"),
          body: JSON.parse(init?.body as string),
        });
        return response(200, { providerCallId: "pstn_1" });
      }) as typeof fetch,
    });

    const result = await provider.placeCall({
      workerId: "worker-1",
      leaseToken: "lease-1",
      leaseExpiresAt: "2026-07-03T00:01:00.000Z",
      attempt: 1,
      dialIdempotencyKey: "agent-dial:call_1",
      draft: {
        id: "draft_1",
        callId: "call_1",
        scenario: "booking",
        status: "dispatching",
        objective: "预约洗牙",
        suggestedScript: "您好，我想预约洗牙",
        targetPhone: "13800138000",
        language: "zh",
        riskLevel: "low",
        riskReasons: [],
        createdAt: "2026-07-03T00:00:00.000Z",
        updatedAt: "2026-07-03T00:00:00.000Z",
      },
    });

    expect(result).toEqual({ status: "in_progress", providerCallId: "pstn_1" });
    expect(requests[0]).toMatchObject({
      url: "https://pstn-bridge.qkxy.cn/agent-calls",
      authorization: "Bearer bridge-secret",
      body: {
        idempotencyKey: "agent-dial:call_1",
        draftId: "draft_1",
        callId: "call_1",
        targetPhone: "13800138000",
        suggestedScript: "您好，我想预约洗牙",
      },
    });
  });
});

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function header(init: RequestInit | undefined, key: string) {
  return (init?.headers as Record<string, string> | undefined)?.[key];
}
