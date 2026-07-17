import { describe, expect, it, vi } from "vitest";
import { HttpCallSipStatusClient } from "./call-sip-status-client.js";

describe("HttpCallSipStatusClient", () => {
  it("posts an authenticated status update without a phone number", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, init });
      return new Response("{}", { status: 200 });
    });
    const client = new HttpCallSipStatusClient({
      apiBaseUrl: "https://api.example.cn/",
      internalApiSecret: "internal-secret",
      timeoutMs: 1000,
      fetchFn,
    });

    await client.reportStatus("call/1", {
      operationId: "op_1",
      participantIdentity: "call_1:guest:sip:op_1",
      participantSid: "PA_1",
      sipCallId: "sip-call-1",
      callStatus: "active",
    });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.cn/internal/call-links/call%2F1/sip-status",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer internal-secret",
          "content-type": "application/json",
        },
      }),
    );
    const body = JSON.parse(requests[0]!.init!.body as string);
    expect(body).toEqual({
      operationId: "op_1",
      participantIdentity: "call_1:guest:sip:op_1",
      participantSid: "PA_1",
      sipCallId: "sip-call-1",
      callStatus: "active",
    });
    expect(JSON.stringify(body)).not.toContain("phone");
  });

  it("rejects a non-success response so the audio gate stays closed", async () => {
    const client = new HttpCallSipStatusClient({
      apiBaseUrl: "https://api.example.cn",
      timeoutMs: 1000,
      fetchFn: async () => new Response("{}", { status: 409 }),
    });

    await expect(client.reportStatus("call_1", {
      operationId: "op_1",
      participantIdentity: "call_1:guest:sip:op_1",
      callStatus: "active",
    })).rejects.toThrow("HTTP 409");
  });
});
