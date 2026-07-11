import { describe, expect, it } from "vitest";
import { HttpAgentCallApiClient } from "./agent-call-api-client.js";

describe("HttpAgentCallApiClient", () => {
  it("polls queued drafts from the internal API", async () => {
    const requests = [];
    const client = new HttpAgentCallApiClient({
      apiBaseUrl: "http://127.0.0.1:3100/",
      internalApiSecret: "internal-secret",
      timeoutMs: 100,
      fetchFn: (async (url: string, init?: RequestInit) => {
        requests.push({ url, authorization: header(init, "authorization") });
        return response(200, { drafts: [{ id: "draft_1", status: "queued" }] });
      }) as typeof fetch,
    });

    const drafts = await client.listQueued(3);

    expect(requests).toEqual([{
      url: "http://127.0.0.1:3100/internal/ai-calling-agent/drafts/queued?limit=3",
      authorization: "Bearer internal-secret",
    }]);
    expect(drafts).toEqual([{ id: "draft_1", status: "queued" }]);
  });

  it("posts worker status updates to the internal API", async () => {
    const requests = [];
    const client = new HttpAgentCallApiClient({
      apiBaseUrl: "http://127.0.0.1:3100",
      timeoutMs: 100,
      fetchFn: (async (url: string, init?: RequestInit) => {
        requests.push({ url, body: JSON.parse(init?.body as string) });
        return response(200, { draft: { id: "draft_1", status: "in_progress" } });
      }) as typeof fetch,
    });

    await client.updateStatus("draft_1", {
      status: "in_progress",
      providerCallId: "provider_1",
    });

    expect(requests).toEqual([{
      url: "http://127.0.0.1:3100/internal/ai-calling-agent/drafts/draft_1/status",
      body: { status: "in_progress", providerCallId: "provider_1" },
    }]);
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
