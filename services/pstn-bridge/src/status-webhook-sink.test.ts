import { describe, expect, it } from "vitest";
import { HttpStatusWebhookSink, signStatusWebhookBody } from "./status-webhook-sink.js";
import type { PstnBridgeEnv, StatusWebhookRequest } from "./types.js";

describe("status webhook sink", () => {
  it("posts signed status webhooks to the API", async () => {
    const calls: Array<{ url: string; headers: HeadersInit; body: StatusWebhookRequest }> = [];
    const sink = new HttpStatusWebhookSink(env(), async (url, init) => {
      calls.push({
        url: String(url),
        headers: init?.headers ?? {},
        body: JSON.parse(String(init?.body)),
      });
      return jsonResponse(200, { status: "updated" });
    });
    const body: StatusWebhookRequest = {
      eventId: "event-1",
      callId: "call-1",
      providerCallId: "provider-call-1",
      status: "completed",
      resultSummary: "done",
    };

    await expect(sink.send(body)).resolves.toEqual({ status: "accepted" });

    expect(calls[0]).toMatchObject({
      url: "https://api.qkxy.cn/webhooks/pstn/agent-calls",
      body,
    });
    expect((calls[0].headers as Record<string, string>)["x-translation-pstn-signature"])
      .toBe(signStatusWebhookBody("status-secret", body));
  });

  it("surfaces API webhook failures", async () => {
    const sink = new HttpStatusWebhookSink(env(), async () =>
      jsonResponse(401, { error: { message: "invalid signature" } }));

    await expect(sink.send({ eventId: "event-2", callId: "call-1", status: "failed" }))
      .rejects.toThrow("invalid signature");
  });

  it("retries transient API webhook failures", async () => {
    const statuses = [503, 200];
    const attempts: string[] = [];
    const sink = new HttpStatusWebhookSink(env({ statusWebhookRetryCount: 1 }), async (_url, init) => {
      attempts.push((init?.headers as Record<string, string>)["x-translation-pstn-attempt"]);
      return jsonResponse(statuses.shift() ?? 200, { status: "updated" });
    });

    await expect(sink.send({ eventId: "event-3", callId: "call-1", status: "completed" }))
      .resolves.toEqual({ status: "accepted" });
    expect(attempts).toEqual(["1", "2"]);
  });

  it("does not retry client-side webhook failures", async () => {
    let calls = 0;
    const sink = new HttpStatusWebhookSink(env({ statusWebhookRetryCount: 2 }), async () => {
      calls += 1;
      return jsonResponse(401, { error: { message: "invalid signature" } });
    });

    await expect(sink.send({ eventId: "event-4", callId: "call-1", status: "failed" }))
      .rejects.toThrow("invalid signature");
    expect(calls).toBe(1);
  });
});

function env(overrides: Partial<PstnBridgeEnv> = {}): PstnBridgeEnv {
  return {
    port: 3302,
    provider: "http",
    upstreamTimeoutMs: 1000,
    mediaWriterTimeoutMs: 1000,
    statusWebhookEndpoint: "https://api.qkxy.cn/webhooks/pstn/agent-calls",
    statusWebhookSecret: "status-secret",
    statusWebhookTimeoutMs: 1000,
    statusWebhookRetryCount: 0,
    statusWebhookRetryDelayMs: 0,
    audioFrameSinkTimeoutMs: 1000,
    providerWebhookMaxSkewMs: 300000,
    recordingDisclosureEnabled: true,
    ...overrides,
  };
}

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as Response;
}
