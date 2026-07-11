import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { signProviderWebhookBody } from "./provider-webhook-auth.js";
import { buildPstnBridgeServer } from "./server.js";
import type { PstnStatusWebhookSink, StatusWebhookRequest } from "./types.js";

describe("provider status events", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    servers.length = 0;
  });

  it("rejects unsigned provider status callbacks", async () => {
    const baseUrl = await startBridge([]);
    const response = await postStatusEvent(baseUrl, statusEvent(), {});

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("invalid_provider_signature");
  });

  it("accepts signed provider status callbacks and forwards API webhook updates", async () => {
    const updates: StatusWebhookRequest[] = [];
    const baseUrl = await startBridge(updates);

    const response = await postStatusEvent(baseUrl, statusEvent(), { secret: "webhook-secret" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "accepted", eventId: "provider-status-1" });
    expect(updates[0]).toEqual({
      eventId: "provider-status-1",
      callId: "call-status-1",
      providerCallId: "provider-call-1",
      status: "in_progress",
      consumedSeconds: 12,
      resultSummary: "callee answered",
      nextStep: "start translation",
    });
  });

  it("drops duplicate signed provider status callbacks by event id", async () => {
    const updates: StatusWebhookRequest[] = [];
    const baseUrl = await startBridge(updates);

    const first = await postStatusEvent(baseUrl, statusEvent(), { secret: "webhook-secret" });
    const duplicate = await postStatusEvent(baseUrl, statusEvent(), { secret: "webhook-secret" });

    expect(first.body.status).toBe("accepted");
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual({ status: "duplicate", eventId: "provider-status-1" });
    expect(updates).toHaveLength(1);
  });

  async function startBridge(updates: StatusWebhookRequest[]) {
    const statusWebhookSink: PstnStatusWebhookSink = {
      async send(request) {
        updates.push(request);
        return { status: "accepted" };
      },
    };
    const server = buildPstnBridgeServer({
      statusWebhookSink,
      env: {
        PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET: "webhook-secret",
        PSTN_BRIDGE_PROVIDER_WEBHOOK_MAX_SKEW_MS: "300000",
      },
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    return `http://127.0.0.1:${address.port}`;
  }
});

function statusEvent() {
  return {
    eventId: "provider-status-1",
    eventType: "call.status",
    callId: "call-status-1",
    providerCallId: "provider-call-1",
    status: "answered",
    consumedSeconds: 12,
    resultSummary: "callee answered",
    nextStep: "start translation",
  };
}

async function postStatusEvent(baseUrl: string, event: unknown, options: { secret?: string }) {
  const body = JSON.stringify(event);
  const timestamp = Date.now();
  const signature = options.secret
    ? signProviderWebhookBody({ body, secret: options.secret, timestamp })
    : undefined;
  const response = await fetch(`${baseUrl}/provider/status-events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pstn-provider-timestamp": String(timestamp),
      ...(signature ? { "x-pstn-provider-signature": signature } : {}),
    },
    body,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
