import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { buildPstnBridgeServer } from "./server.js";
import type {
  AgentCallBridgeRequest,
  AudioFrameSinkRequest,
  PstnAudioFrameSink,
  PstnProvider,
  TtsAudioSinkRequest,
} from "./types.js";

describe("pstn bridge server", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    servers.length = 0;
  });

  it("serves health with release readiness details", async () => {
    const baseUrl = await startBridge({
      PSTN_BRIDGE_API_KEY: "bridge-secret",
    });

    const health = await requestJson(`${baseUrl}/health`);
    const release = await requestJson(`${baseUrl}/health/release-ready`);

    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ service: "pstn-bridge", provider: "mock" });
    expect(release.status).toBe(503);
    expect(release.body.issues).toContain("pstn_bridge provider must not be mock for release");
  });

  it("requires the bridge api key before accepting agent calls", async () => {
    const baseUrl = await startBridge({ PSTN_BRIDGE_API_KEY: "bridge-secret" });

    const rejected = await requestJson(`${baseUrl}/agent-calls`, {
      method: "POST",
      body: agentCall(),
    });

    expect(rejected.status).toBe(401);
    expect(rejected.body.error.code).toBe("invalid_bridge_api_key");
  });

  it("submits valid agent calls to the configured provider", async () => {
    const calls: AgentCallBridgeRequest[] = [];
    const provider: PstnProvider = {
      async placeCall(request) {
        calls.push(request);
        return { status: "in_progress", providerCallId: "provider-call-1" };
      },
      async playTranslatedAudio() {
        return { status: "queued" };
      },
    };
    const baseUrl = await startBridge({ PSTN_BRIDGE_API_KEY: "bridge-secret" }, { provider });

    const accepted = await requestJson(`${baseUrl}/agent-calls`, {
      method: "POST",
      bearerToken: "bridge-secret",
      body: agentCall(),
    });

    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ status: "in_progress", providerCallId: "provider-call-1" });
    expect(calls[0]).toMatchObject({ callId: "call-1", targetPhone: "13800138000" });
  });

  it("accepts translated TTS audio for playback by the target speaker role", async () => {
    const playbackRequests: TtsAudioSinkRequest[] = [];
    const provider: PstnProvider = {
      async placeCall() {
        return { status: "in_progress" };
      },
      async playTranslatedAudio(request) {
        playbackRequests.push(request);
        return { status: "queued", providerPlaybackId: "playback-1" };
      },
    };
    const baseUrl = await startBridge({ PSTN_BRIDGE_API_KEY: "bridge-secret" }, { provider });

    const accepted = await requestJson(`${baseUrl}/translated-audio`, {
      method: "POST",
      bearerToken: "bridge-secret",
      body: translatedAudio(),
    });

    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ status: "queued", providerPlaybackId: "playback-1" });
    expect(playbackRequests[0]).toMatchObject({
      callId: "call-1",
      segmentId: "seg-1",
      sourceSpeakerRole: "host",
      targetSpeakerRole: "guest",
      language: "en",
      audio: { format: "pcm16", sampleRate: 16000, data: "AA==" },
    });
  });

  it("rejects invalid translated audio before calling the provider", async () => {
    let playbackCount = 0;
    const provider: PstnProvider = {
      async placeCall() {
        return { status: "in_progress" };
      },
      async playTranslatedAudio() {
        playbackCount += 1;
        return { status: "queued" };
      },
    };
    const baseUrl = await startBridge({ PSTN_BRIDGE_API_KEY: "bridge-secret" }, { provider });

    const rejected = await requestJson(`${baseUrl}/translated-audio`, {
      method: "POST",
      bearerToken: "bridge-secret",
      body: { ...translatedAudio(), targetSpeakerRole: "host" },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe("invalid_translated_audio");
    expect(playbackCount).toBe(0);
  });

  it("accepts PSTN media frames and forwards normalized PCM16 audio", async () => {
    const frames: AudioFrameSinkRequest[] = [];
    const audioFrameSink: PstnAudioFrameSink = {
      async send(request) {
        frames.push(request);
        return { status: "accepted", acceptedFrameId: "frame-1" };
      },
    };
    const baseUrl = await startBridge({ PSTN_BRIDGE_API_KEY: "bridge-secret" }, {
      audioFrameSink,
    });

    const accepted = await requestJson(`${baseUrl}/media-frames`, {
      method: "POST",
      bearerToken: "bridge-secret",
      body: mediaFrame(),
    });

    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ status: "accepted", acceptedFrameId: "frame-1" });
    expect(frames[0]).toMatchObject({
      callId: "call-1",
      mediaStreamId: "stream-1",
      sourceSpeakerRole: "guest",
      sequence: 1,
      audio: { format: "pcm16", sampleRate: 16000, data: "AAAAAA==" },
    });
  });

  it("rejects media frames when no audio frame sink is configured", async () => {
    const baseUrl = await startBridge({ PSTN_BRIDGE_API_KEY: "bridge-secret" });

    const rejected = await requestJson(`${baseUrl}/media-frames`, {
      method: "POST",
      bearerToken: "bridge-secret",
      body: mediaFrame(),
    });

    expect(rejected.status).toBe(503);
    expect(rejected.body.error.code).toBe("audio_frame_sink_not_configured");
  });

  it("rejects invalid PSTN media frames before calling the sink", async () => {
    let frameCount = 0;
    const baseUrl = await startBridge({ PSTN_BRIDGE_API_KEY: "bridge-secret" }, {
      audioFrameSink: { send: async () => {
        frameCount += 1;
        return { status: "accepted" };
      } },
    });

    const rejected = await requestJson(`${baseUrl}/media-frames`, {
      method: "POST",
      bearerToken: "bridge-secret",
      body: { ...mediaFrame(), audio: { encoding: "pcm16", sampleRate: 16000, data: "AA==" } },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe("invalid_media_frame");
    expect(frameCount).toBe(0);
  });

  async function startBridge(env: NodeJS.ProcessEnv, options: {
    provider?: PstnProvider;
    audioFrameSink?: PstnAudioFrameSink;
  } = {}) {
    const server = buildPstnBridgeServer({ env, ...options });
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

function agentCall() {
  return {
    draftId: "draft-1",
    callId: "call-1",
    targetPhone: "13800138000",
    objective: "预约明天下午三点的会议室",
    suggestedScript: "您好，我想预约明天下午三点的会议室。",
    language: "zh",
  };
}

function translatedAudio() {
  return {
    callId: "call-1",
    segmentId: "seg-1",
    sourceSpeakerRole: "host",
    targetSpeakerRole: "guest",
    language: "en",
    provider: "qwen3-tts",
    model: "qwen3-tts-0.6b",
    firstAudioMs: 380,
    audioDurationMs: 1200,
    audio: {
      format: "pcm16",
      sampleRate: 16000,
      data: "AA==",
    },
  };
}

function mediaFrame() {
  return {
    callId: "call-1",
    providerCallId: "provider-call-1",
    mediaStreamId: "stream-1",
    sourceSpeakerRole: "guest",
    sequence: 1,
    timestampMs: 1000,
    provider: "domestic_bridge",
    audio: {
      encoding: "mulaw8k",
      sampleRate: 8000,
      durationMs: 1,
      data: "/w==",
    },
  };
}

async function requestJson(url: string, options: {
  method?: string;
  bearerToken?: string;
  body?: unknown;
} = {}) {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.bearerToken ? { authorization: `Bearer ${options.bearerToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
