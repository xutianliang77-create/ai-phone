import { describe, expect, it, vi } from "vitest";
import { HttpCallDiagnosticsClient } from "./call-diagnostics-client.js";

describe("HttpCallDiagnosticsClient", () => {
  it("posts one bounded node report to the call diagnostics endpoint", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = new HttpCallDiagnosticsClient({
      apiBaseUrl: "https://api.example.cn/",
      internalApiSecret: "internal-secret",
      timeoutMs: 1000,
      fetchFn,
    });

    await client.report("call/1", {
      nodeId: "node-a",
      runtimeId: "runtime-a",
      startedAtMs: 100,
      endedAtMs: 200,
      audioLegs: [],
      modelFingerprints: [],
    });

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      "https://api.example.cn/internal/call-links/call%2F1/diagnostics",
    );
    const request = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({
      authorization: "Bearer internal-secret",
    });
    expect(JSON.parse(String(request.body))).toMatchObject({
      version: 1,
      node: { runtimeId: "runtime-a" },
    });
  });
});
