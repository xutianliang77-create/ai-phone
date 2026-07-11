import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { signProviderWebhookBody } from "./provider-webhook-auth.js";
import { buildPstnBridgeServer } from "./server.js";
import type { AudioFrameSinkRequest, PstnAudioFrameSink } from "./types.js";

describe("provider media events", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    servers.length = 0;
  });

  it("rejects unsigned provider callbacks", async () => {
    const baseUrl = await startBridge([]);
    const response = await postProviderEvent(baseUrl, mediaEvent(), {});

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("invalid_provider_signature");
  });

  it("accepts signed provider media callbacks and forwards normalized PCM16 audio", async () => {
    const frames: AudioFrameSinkRequest[] = [];
    const baseUrl = await startBridge(frames);

    const response = await postProviderEvent(baseUrl, mediaEvent(), { secret: "webhook-secret" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "accepted",
      eventId: "provider-event-1",
      acceptedFrameId: "frame-7",
    });
    expect(frames[0]).toMatchObject({
      callId: "call-provider-1",
      providerCallId: "provider-call-1",
      mediaStreamId: "stream-provider-1",
      sourceSpeakerRole: "guest",
      sequence: 7,
      provider: "domestic_bridge",
      audio: { format: "pcm16", sampleRate: 16000, data: "AAAAAA==" },
    });
  });

  it("drops duplicate signed provider media callbacks by event id", async () => {
    const frames: AudioFrameSinkRequest[] = [];
    const baseUrl = await startBridge(frames);

    const first = await postProviderEvent(baseUrl, mediaEvent(), { secret: "webhook-secret" });
    const duplicate = await postProviderEvent(baseUrl, mediaEvent(), { secret: "webhook-secret" });

    expect(first.body.status).toBe("accepted");
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual({ status: "duplicate", eventId: "provider-event-1" });
    expect(frames).toHaveLength(1);
  });

  async function startBridge(frames: AudioFrameSinkRequest[]) {
    const audioFrameSink: PstnAudioFrameSink = {
      async send(request) {
        frames.push(request);
        return { status: "accepted", acceptedFrameId: `frame-${request.sequence}` };
      },
    };
    const server = buildPstnBridgeServer({
      audioFrameSink,
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

function mediaEvent() {
  return {
    eventId: "provider-event-1",
    eventType: "media.frame",
    callId: "call-provider-1",
    providerCallId: "provider-call-1",
    mediaStreamId: "stream-provider-1",
    sourceSpeakerRole: "guest",
    sequence: 7,
    timestampMs: 1000,
    provider: "domestic_bridge",
    audio: { encoding: "mulaw8k", sampleRate: 8000, durationMs: 1, data: "/w==" },
  };
}

async function postProviderEvent(baseUrl: string, event: unknown, options: { secret?: string }) {
  const body = JSON.stringify(event);
  const timestamp = Date.now();
  const signature = options.secret
    ? signProviderWebhookBody({ body, secret: options.secret, timestamp })
    : undefined;
  const response = await fetch(`${baseUrl}/provider/media-events`, {
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
