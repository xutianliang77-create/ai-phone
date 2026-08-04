import { describe, expect, test } from "vitest";
import {
  buildTranslationWorkerPstnAudioSinkConfig,
  probeTranslationWorkerPstnAudioSink,
} from "./translation_worker_pstn_audio_sink_readiness.mjs";

describe("buildTranslationWorkerPstnAudioSinkConfig", () => {
  test("builds isolated Translation Worker PSTN audio sink settings", async () => {
    const config = await buildTranslationWorkerPstnAudioSinkConfig({
      root: "/repo",
      workerPort: 3512,
      mockPort: 3513,
      timeoutMs: 1234,
    });

    expect(config.workerBaseUrl).toBe("http://127.0.0.1:3512");
    expect(config.mockBaseUrl).toBe("http://127.0.0.1:3513");
    expect(config.workerEnv.TRANSLATION_WORKER_AUDIO_FRAME_SINK_PORT).toBe("3512");
    expect(config.workerEnv.ASR_HTTP_ENDPOINT).toBe("http://127.0.0.1:3513/asr/transcribe");
    expect(config.workerEnv.TTS_AUDIO_SINK_ENDPOINT).toBe("http://127.0.0.1:3513/tts/play");
    expect(config.workerEnv.TTS_PROVIDER).toBe("mock-tts");
    expect(config.workerEnv.TTS_MODEL).toBe("mock-phone-voice");
  });
});

describe("probeTranslationWorkerPstnAudioSink", () => {
  test("passes when a PSTN frame produces captions and TTS playback", async () => {
    const checks = [];
    const issues = [];
    const mock = recordingMock({ includeEvents: false });
    mock.playbackRequests.length = 0;
    setTimeout(() => {
      mock.eventRequests.push({
        body: { events: [{ type: "translation.final", translatedText: "电话来音已翻译" }] },
      });
      mock.playbackRequests.push({
        body: {
          callId: "call-pstn-smoke",
          targetSpeakerRole: "host",
          audio: { format: "pcm16" },
        },
      });
    }, 10);

    await probeTranslationWorkerPstnAudioSink({
      baseUrl: "http://127.0.0.1:3512",
      audioSinkKey: "local-translation-worker-frame-sink-secret",
      mock,
      checks,
      issues,
      actions: [],
      timeoutMs: 1000,
      settleTimeoutMs: 100,
      fetchFn: fakeWorkerFetch(mock),
    });

    expect(issues).toEqual([]);
    expect(checks.map((check) => [check.name, check.status])).toEqual([
      ["pstn_audio_sink_service_identity", "pass"],
      ["pstn_audio_frame_requires_key", "pass"],
      ["pstn_audio_frame_rejects_invalid_payload", "pass"],
      ["pstn_audio_frame_accepted", "pass"],
      ["pstn_audio_duplicate_dropped", "pass"],
      ["pstn_audio_reached_asr", "pass"],
      ["pstn_audio_translation_called", "pass"],
      ["pstn_audio_events_published", "pass"],
      ["pstn_audio_tts_playback_sent", "pass"],
    ]);
  });

  test("fails when the Worker accepts frames but does not publish events", async () => {
    const checks = [];
    const issues = [];

    await probeTranslationWorkerPstnAudioSink({
      baseUrl: "http://127.0.0.1:3512",
      audioSinkKey: "local-translation-worker-frame-sink-secret",
      mock: recordingMock({ includeEvents: false }),
      checks,
      issues,
      actions: [],
      timeoutMs: 1000,
      settleTimeoutMs: 10,
      fetchFn: fakeWorkerFetch(null),
    });

    expect(issues).toContain("Translation Worker PSTN audio sink smoke failed.");
    expect(checks.find((check) => check.name === "pstn_audio_events_published")?.status).toBe("fail");
  });
});

function recordingMock(options = {}) {
  return {
    asrRequests: [{
      body: { sessionId: "call-pstn-smoke:guest", format: "pcm16", sampleRate: 16000 },
    }],
    translationRequests: [{}],
    eventRequests: options.includeEvents === false ? [] : [{
      body: { events: [{ type: "translation.final", translatedText: "电话来音已翻译" }] },
    }],
    playbackRequests: [{
      body: {
        callId: "call-pstn-smoke",
        targetSpeakerRole: "host",
        audio: { format: "pcm16" },
      },
    }],
  };
}

function fakeWorkerFetch(mock) {
  let accepted = false;
  return async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    const authorization = init.headers?.authorization;
    if (path === "/health") {
      return jsonResponse(200, { service: "translation-worker-pstn-audio-frame-sink" });
    }
    if (path === "/pstn/audio-frames" && !authorization) {
      return jsonResponse(401, { error: { code: "invalid_pstn_audio_frame_sink_key" } });
    }
    if (path === "/pstn/audio-frames" && body.audio.sampleRate !== 16000) {
      return jsonResponse(400, { error: { code: "invalid_pstn_audio_frame" } });
    }
    if (path === "/pstn/audio-frames" && accepted) {
      return jsonResponse(200, { status: "dropped" });
    }
    if (path === "/pstn/audio-frames") {
      accepted = true;
      if (mock) {
        mock.asrRequests.push({
          body: { sessionId: "call-pstn-smoke:guest", format: "pcm16", sampleRate: 16000 },
        });
      }
      return jsonResponse(200, { status: "accepted", acceptedFrameId: "call-pstn-smoke:guest:1" });
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
