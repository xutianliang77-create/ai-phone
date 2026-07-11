import { describe, expect, test } from "vitest";
import {
  buildPstnBridgeMediaIngestConfig,
  probePstnBridgeMediaIngest,
} from "./pstn_bridge_media_ingest_readiness.mjs";

describe("buildPstnBridgeMediaIngestConfig", () => {
  test("builds isolated PSTN Bridge media ingest settings", async () => {
    const config = await buildPstnBridgeMediaIngestConfig({
      root: "/repo",
      bridgePort: 3422,
      sinkPort: 3423,
      timeoutMs: 1234,
    });

    expect(config.bridgeBaseUrl).toBe("http://127.0.0.1:3422");
    expect(config.sinkBaseUrl).toBe("http://127.0.0.1:3423");
    expect(config.timeoutMs).toBe(1234);
    expect(config.bridgeEnv.PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT)
      .toBe("http://127.0.0.1:3423/audio-frames");
  });
});

describe("probePstnBridgeMediaIngest", () => {
  test("passes when media frames are accepted and forwarded to sink", async () => {
    const checks = [];
    const issues = [];
    const sink = { frameRequests: [] };

    await probePstnBridgeMediaIngest({
      baseUrl: "http://127.0.0.1:3422",
      bridgeApiKey: "local-pstn-bridge-secret",
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
      ["media_frame_requires_bridge_key", "pass"],
      ["media_frame_rejects_invalid_payload", "pass"],
      ["media_frame_accepted", "pass"],
      ["media_frame_forwarded_to_audio_sink", "pass"],
    ]);
  });

  test("fails when media frames are accepted but not forwarded", async () => {
    const checks = [];
    const issues = [];

    await probePstnBridgeMediaIngest({
      baseUrl: "http://127.0.0.1:3422",
      bridgeApiKey: "local-pstn-bridge-secret",
      sink: { frameRequests: [] },
      checks,
      issues,
      actions: [],
      timeoutMs: 1000,
      fetchFn: fakeBridgeFetch(null),
    });

    expect(issues).toContain("PSTN Bridge media ingest smoke failed.");
    expect(checks.find((check) => check.name === "media_frame_forwarded_to_audio_sink")?.status)
      .toBe("fail");
  });
});

function fakeBridgeFetch(sink) {
  return async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    const authorization = init.headers?.authorization;
    if (path === "/health") {
      return jsonResponse(200, { service: "pstn-bridge", provider: "mock" });
    }
    if (path === "/media-frames" && !authorization) {
      return jsonResponse(401, { error: { code: "invalid_bridge_api_key" } });
    }
    if (path === "/media-frames" && body.audio.encoding !== "mulaw8k") {
      return jsonResponse(400, { error: { code: "invalid_media_frame" } });
    }
    if (path === "/media-frames") {
      sink?.frameRequests.push({
        headers: { authorization: "Bearer local-pstn-frame-sink-secret" },
        body: {
          callId: "call-media-smoke",
          mediaStreamId: "stream-media-smoke",
          sourceSpeakerRole: "guest",
          audio: { format: "pcm16", sampleRate: 16000, data: "AAAAAA==" },
        },
        response: { status: "accepted", acceptedFrameId: "frame-1" },
      });
      return jsonResponse(200, { status: "accepted", acceptedFrameId: "frame-1" });
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
