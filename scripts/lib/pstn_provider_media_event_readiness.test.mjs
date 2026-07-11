import { describe, expect, test } from "vitest";
import {
  buildPstnProviderMediaEventConfig,
  probePstnProviderMediaEvent,
} from "./pstn_provider_media_event_readiness.mjs";

describe("buildPstnProviderMediaEventConfig", () => {
  test("builds isolated PSTN provider media event settings", async () => {
    const config = await buildPstnProviderMediaEventConfig({
      root: "/repo",
      bridgePort: 3424,
      sinkPort: 3425,
      timeoutMs: 1234,
    });

    expect(config.bridgeBaseUrl).toBe("http://127.0.0.1:3424");
    expect(config.sinkBaseUrl).toBe("http://127.0.0.1:3425");
    expect(config.timeoutMs).toBe(1234);
    expect(config.bridgeEnv.PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET)
      .toBe("local-pstn-provider-webhook-secret");
  });
});

describe("probePstnProviderMediaEvent", () => {
  test("passes when signed provider events are accepted and forwarded", async () => {
    const checks = [];
    const issues = [];
    const sink = { frameRequests: [] };

    await probePstnProviderMediaEvent({
      baseUrl: "http://127.0.0.1:3424",
      sink,
      checks,
      issues,
      actions: [],
      timeoutMs: 1000,
      fetchFn: fakeBridgeFetch(sink),
    });

    expect(issues).toEqual([]);
    expect(checks.map((check) => [check.name, check.status])).toEqual([
      ["pstn_bridge_service_identity", "pass"],
      ["provider_media_event_requires_signature", "pass"],
      ["provider_media_event_rejects_invalid_payload", "pass"],
      ["provider_media_event_accepted", "pass"],
      ["provider_media_event_deduplicates_event_id", "pass"],
      ["provider_media_event_forwarded_to_audio_sink", "pass"],
    ]);
  });

  test("fails when accepted provider events are not forwarded", async () => {
    const checks = [];
    const issues = [];

    await probePstnProviderMediaEvent({
      baseUrl: "http://127.0.0.1:3424",
      sink: { frameRequests: [] },
      checks,
      issues,
      actions: [],
      timeoutMs: 1000,
      fetchFn: fakeBridgeFetch(null),
    });

    expect(issues).toContain("PSTN provider media event smoke failed.");
    expect(checks.find((check) => check.name === "provider_media_event_forwarded_to_audio_sink")?.status)
      .toBe("fail");
  });
});

function fakeBridgeFetch(sink) {
  const seenEventIds = new Set();
  return async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    const signature = init.headers?.["x-pstn-provider-signature"];
    if (path === "/health") {
      return jsonResponse(200, { service: "pstn-bridge", provider: "mock" });
    }
    if (path === "/provider/media-events" && !signature) {
      return jsonResponse(401, { error: { code: "invalid_provider_signature" } });
    }
    if (path === "/provider/media-events" && body.eventType !== "media.frame") {
      return jsonResponse(400, { error: { code: "invalid_provider_media_event" } });
    }
    if (path === "/provider/media-events") {
      if (seenEventIds.has(body.eventId)) {
        return jsonResponse(200, { status: "duplicate", eventId: body.eventId });
      }
      seenEventIds.add(body.eventId);
      sink?.frameRequests.push({
        headers: { authorization: "Bearer local-pstn-frame-sink-secret" },
        body: {
          callId: "call-provider-media-smoke",
          mediaStreamId: "stream-provider-media-smoke",
          sourceSpeakerRole: "guest",
          audio: { format: "pcm16", sampleRate: 16000, data: "AAAAAA==" },
        },
        response: { status: "accepted", acceptedFrameId: "provider-frame-1" },
      });
      return jsonResponse(200, { status: "accepted", acceptedFrameId: "provider-frame-1" });
    }
    return jsonResponse(404, { error: { message: `unexpected ${path}` } });
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
