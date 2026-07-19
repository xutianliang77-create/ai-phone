import { describe, expect, it } from "vitest";
import type { AgentCallWorkerClaimDto } from "@translation/contracts";
import { HttpAgentCallApiClient } from "./agent-call-api-client.js";

describe("HttpAgentCallApiClient", () => {
  it("claims queued drafts from the internal API", async () => {
    const requests = [];
    const client = new HttpAgentCallApiClient({
      apiBaseUrl: "http://127.0.0.1:3100/",
      internalApiSecret: "internal-secret",
      timeoutMs: 100,
      fetchFn: (async (url: string, init?: RequestInit) => {
        requests.push({
          url,
          authorization: header(init, "authorization"),
          body: JSON.parse(init?.body as string),
        });
        return response(200, { claims: [claim()] });
      }) as typeof fetch,
    });

    const claims = await client.claim("worker-1", 3);

    expect(requests).toEqual([{
      url: "http://127.0.0.1:3100/internal/ai-calling-agent/drafts/claims",
      authorization: "Bearer internal-secret",
      body: { workerId: "worker-1", limit: 3 },
    }]);
    expect(claims).toEqual([claim()]);
  });

  it("posts worker status updates to the internal API", async () => {
    const requests = [];
    const client = new HttpAgentCallApiClient({
      apiBaseUrl: "http://127.0.0.1:3100",
      timeoutMs: 100,
      fetchFn: (async (url: string, init?: RequestInit) => {
        requests.push({
          url,
          workerId: header(init, "x-agent-worker-id"),
          leaseToken: header(init, "x-agent-call-lease-token"),
          body: JSON.parse(init?.body as string),
        });
        return response(200, { draft: { id: "draft_1", status: "in_progress" } });
      }) as typeof fetch,
    });

    await client.updateStatus(claim(), {
      status: "in_progress",
      providerCallId: "provider_1",
    });

    expect(requests).toEqual([{
      url: "http://127.0.0.1:3100/internal/ai-calling-agent/drafts/draft_1/status",
      workerId: "worker-1",
      leaseToken: "lease-token-1",
      body: { status: "in_progress", providerCallId: "provider_1" },
    }]);
  });
});

function claim(): AgentCallWorkerClaimDto {
  return {
    workerId: "worker-1",
    leaseToken: "lease-token-1",
    leaseExpiresAt: "2026-07-17T00:01:00.000Z",
    attempt: 1,
    dialIdempotencyKey: "agent-dial:call-1",
    draft: {
      id: "draft_1",
      callId: "call-1",
      scenario: "booking",
      status: "dispatching",
      objective: "预约洗牙",
      suggestedScript: "您好，我想预约洗牙",
      targetPhone: "13800138000",
      language: "zh",
      riskLevel: "low",
      riskReasons: [],
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    },
  };
}

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
