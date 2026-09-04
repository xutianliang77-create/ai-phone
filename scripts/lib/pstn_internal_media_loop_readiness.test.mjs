import { describe, expect, test } from "vitest";
import {
  buildPstnInternalMediaLoopConfig,
  probePstnInternalMediaLoop,
} from "./pstn_internal_media_loop_readiness.mjs";

describe("buildPstnInternalMediaLoopConfig", () => {
  test("wires PSTN Bridge to Translation Worker and mock providers", async () => {
    const config = await buildPstnInternalMediaLoopConfig({
      root: "/repo",
      bridgePort: 3610,
      workerPort: 3611,
      mockPort: 3612,
      timeoutMs: 1234,
    });

    expect(config.bridgeBaseUrl).toBe("http://127.0.0.1:3610");
    expect(config.workerBaseUrl).toBe("http://127.0.0.1:3611");
    expect(config.bridgeEnv.PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT)
      .toBe("http://127.0.0.1:3611/pstn/audio-frames");
    expect(config.workerEnv.TTS_AUDIO_SINK_ENDPOINT).toBe("http://127.0.0.1:3610/translated-audio");
    expect(config.workerEnv.ASR_HTTP_ENDPOINT).toBe("http://127.0.0.1:3612/asr/transcribe");
    expect(config.workerEnv.TTS_PROVIDER).toBe("mock-tts");
    expect(config.workerEnv.TTS_MODEL).toBe("mock-phone-voice");
  });
});

describe("probePstnInternalMediaLoop", () => {
  test("passes when media frame produces captions and media write", async () => {
    const checks = [];
    const issues = [];
    const mock = recordingMock();

    await probePstnInternalMediaLoop({
      bridgeBaseUrl: "http://127.0.0.1:3610",
      workerBaseUrl: "http://127.0.0.1:3611",
      bridgeApiKey: "local-pstn-loop-bridge-secret",
      mock,
      checks,
      issues,
      actions: [],
      timeoutMs: 1000,
      settleTimeoutMs: 10,
      fetchFn: fakeLoopFetch(mock),
    });

    expect(issues).toEqual([]);
    expect(checks.map((check) => [check.name, check.status])).toEqual([
      ["loop_pstn_bridge_identity", "pass"],
      ["loop_worker_audio_sink_identity", "pass"],
      ["loop_call_route_created", "pass"],
      ["loop_media_frame_accepted", "pass"],
      ["loop_frame_reached_worker_asr", "pass"],
      ["loop_caption_events_published", "pass"],
      ["loop_tts_returned_to_bridge_upstream", "pass"],
      ["loop_tts_written_to_media", "pass"],
    ]);
  });

  test("fails when media writer does not receive translated audio", async () => {
    const checks = [];
    const issues = [];

    await probePstnInternalMediaLoop({
      bridgeBaseUrl: "http://127.0.0.1:3610",
      workerBaseUrl: "http://127.0.0.1:3611",
      bridgeApiKey: "local-pstn-loop-bridge-secret",
      mock: recordingMock({ includeMediaWrite: false }),
      checks,
      issues,
      actions: [],
      timeoutMs: 1000,
      settleTimeoutMs: 10,
      fetchFn: fakeLoopFetch(null),
    });

    expect(issues).toContain("PSTN internal media loop smoke failed.");
    expect(checks.find((check) => check.name === "loop_tts_written_to_media")?.status).toBe("fail");
  });
});

function recordingMock(options = {}) {
  return {
    asrRequests: [{
      body: { sessionId: "call-loop:guest", format: "pcm16", sampleRate: 16000 },
    }],
    eventRequests: [{
      body: { events: [{ type: "translation.final", translatedText: "内部媒体闭环已翻译" }] },
    }],
    audioRequests: [{
      body: {
        callId: "call-loop",
        providerCallId: "upstream-call-loop",
        mediaStreamId: "upstream-stream-loop",
        targetSpeakerRole: "host",
        telephonyAudio: { encoding: "mulaw8k" },
      },
    }],
    mediaWriteRequests: options.includeMediaWrite === false ? [] : [{
      body: {
        callId: "call-loop",
        mediaStreamId: "upstream-stream-loop",
        targetSpeakerRole: "host",
        telephonyAudio: { sampleRate: 8000 },
      },
    }],
  };
}

function fakeLoopFetch(mock) {
  return async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname === "/health" && url.includes(":3610")) {
      return jsonResponse(200, { service: "pstn-bridge" });
    }
    if (pathname === "/health" && url.includes(":3611")) {
      return jsonResponse(200, { service: "translation-worker-pstn-audio-frame-sink" });
    }
    if (pathname === "/agent-calls") {
      const body = init.body ? JSON.parse(init.body) : null;
      if (!body?.idempotencyKey ||
        init.headers?.["idempotency-key"] !== body.idempotencyKey) {
        return jsonResponse(400, { error: { code: "invalid_idempotency_key" } });
      }
      return jsonResponse(200, { providerCallId: "upstream-call-loop", mediaStreamId: "upstream-stream-loop" });
    }
    if (pathname === "/media-frames") {
      if (mock) {
        mock.asrRequests.push({
          body: { sessionId: "call-loop:guest", format: "pcm16", sampleRate: 16000 },
        });
      }
      return jsonResponse(200, { status: "accepted", acceptedFrameId: "call-loop:guest:1" });
    }
    return jsonResponse(404, { error: { message: `unexpected ${pathname}` } });
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
