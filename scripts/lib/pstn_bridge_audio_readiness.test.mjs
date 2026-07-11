import { describe, expect, test } from "vitest";
import {
  buildPstnBridgeAudioReadinessConfig,
  probePstnBridgeTranslatedAudio,
} from "./pstn_bridge_audio_readiness.mjs";

describe("buildPstnBridgeAudioReadinessConfig", () => {
  test("builds isolated PSTN Bridge audio smoke settings", async () => {
    const config = await buildPstnBridgeAudioReadinessConfig({
      root: "/repo",
      bridgePort: 3422,
      upstreamPort: 3423,
      timeoutMs: 1234,
    });

    expect(config.bridgeBaseUrl).toBe("http://127.0.0.1:3422");
    expect(config.upstreamBaseUrl).toBe("http://127.0.0.1:3423");
    expect(config.timeoutMs).toBe(1234);
    expect(config.bridgeEnv.PSTN_BRIDGE_PROVIDER).toBe("http");
    expect(config.bridgeEnv.PSTN_BRIDGE_UPSTREAM_BASE_URL).toBe("http://127.0.0.1:3423");
    expect(config.bridgeEnv.PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT)
      .toBe("http://127.0.0.1:3423/media/write");
  });
});

describe("probePstnBridgeTranslatedAudio", () => {
  test("passes when translated audio is accepted and forwarded upstream", async () => {
    const checks = [];
    const issues = [];
    const upstream = { audioRequests: [], mediaWriteRequests: [] };

    await probePstnBridgeTranslatedAudio({
      baseUrl: "http://127.0.0.1:3422",
      bridgeApiKey: "local-pstn-bridge-secret",
      upstream,
      checks,
      issues,
      actions: [],
      timeoutMs: 1000,
      fetchFn: fakeBridgeFetch(upstream),
    });

    expect(issues).toEqual([]);
    expect(checks.map((check) => [check.name, check.status])).toEqual([
      ["pstn_bridge_service_identity", "pass"],
      ["translated_audio_requires_bridge_key", "pass"],
      ["translated_audio_rejects_invalid_payload", "pass"],
      ["pstn_bridge_call_route_created", "pass"],
      ["translated_audio_accepted", "pass"],
      ["translated_audio_forwarded_to_upstream", "pass"],
      ["translated_audio_written_to_media", "pass"],
    ]);
  });

  test("fails when the bridge accepts audio but does not forward upstream", async () => {
    const checks = [];
    const issues = [];

    await probePstnBridgeTranslatedAudio({
      baseUrl: "http://127.0.0.1:3422",
      bridgeApiKey: "local-pstn-bridge-secret",
      upstream: { audioRequests: [], mediaWriteRequests: [] },
      checks,
      issues,
      actions: [],
      timeoutMs: 1000,
      fetchFn: fakeBridgeFetch(null),
    });

    expect(issues).toContain("PSTN Bridge translated audio playback smoke failed.");
    expect(checks.find((check) => check.name === "translated_audio_forwarded_to_upstream")?.status)
      .toBe("fail");
    expect(checks.find((check) => check.name === "translated_audio_written_to_media")?.status)
      .toBe("fail");
  });
});

function fakeBridgeFetch(upstream) {
  return async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    const authorization = init.headers?.authorization;
    if (path === "/health") {
      return jsonResponse(200, { service: "pstn-bridge", provider: "http" });
    }
    if (path === "/translated-audio" && !authorization) {
      return jsonResponse(401, { error: { code: "invalid_bridge_api_key" } });
    }
    if (path === "/translated-audio" && body.sourceSpeakerRole === body.targetSpeakerRole) {
      return jsonResponse(400, { error: { code: "invalid_translated_audio" } });
    }
    if (path === "/agent-calls") {
      return jsonResponse(200, {
        status: "in_progress",
        providerCallId: "upstream-call-audio-smoke",
        mediaStreamId: "upstream-stream-audio-smoke",
      });
    }
    if (path === "/translated-audio") {
      upstream?.audioRequests.push({
        headers: { authorization: "Bearer local-pstn-upstream-secret" },
        body: {
          ...body,
          providerCallId: "upstream-call-audio-smoke",
          mediaStreamId: "upstream-stream-audio-smoke",
          telephonyAudio: { encoding: "mulaw8k", sampleRate: 8000, data: "/w==" },
        },
        response: { status: "played", providerPlaybackId: "upstream-playback-seg-audio-smoke" },
      });
      upstream?.mediaWriteRequests.push({
        headers: { authorization: "Bearer local-pstn-media-writer-secret" },
        body: {
          callId: "call-audio-smoke",
          providerCallId: "upstream-call-audio-smoke",
          mediaStreamId: "upstream-stream-audio-smoke",
          segmentId: "seg-audio-smoke",
          targetSpeakerRole: "guest",
          telephonyAudio: { encoding: "mulaw8k", sampleRate: 8000, data: "/w==" },
        },
        response: { mediaWriteId: "media-write-seg-audio-smoke" },
      });
      return jsonResponse(200, { status: "played", providerPlaybackId: "upstream-playback-seg-audio-smoke" });
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
