import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { runSipTranslationLoadSession } from "./sip_translation_load_session.mjs";
import { redactPhoneNumbers } from "./phone_redaction.mjs";

describe("SIP translation load session", () => {
  it("dials once, proves replay fencing, translates, plays, and hangs up", async () => {
    const clock = new FakeClock();
    const requests = [];
    const runtime = new FakeRtcRuntime();
    const targetPhone = "+8613800138000";
    const result = await runSipTranslationLoadSession({
      root: process.cwd(),
      apiBaseUrl: "https://staging.example.cn",
      sessionId: "capacity-25-sip-001",
      targetPhone,
      durationMs: 1000,
      accountToken: "account-secret",
      requestTimeoutMs: 1000,
      eventTimeoutMs: 1000,
      answerTimeoutMs: 1000,
      statusPollMs: 100,
      utteranceIntervalMs: 1000,
      endpointSilenceMs: 20,
      nowMs: () => clock.now,
      sleep: (ms) => clock.sleep(ms),
      readWav: () => ({ sampleRate: 1000, pcm: pcm([100, 200]) }),
      loadRtcNode: async () => runtime.module,
      fetchFn: fakeApi(requests),
    });

    expect(result).toMatchObject({
      status: "passed",
      environment: "staging",
      realProviderTraffic: true,
      observedDurationMs: 1000,
      trafficKinds: ["api", "livekit", "sip", "asr", "mt", "tts"],
      finalEventObserved: true,
      providerSideEffectDuplicates: 0,
      completedUtterances: 1,
      endedStatus: "ended",
    });
    expect(result.providerEvidence).toMatchObject({
      sip: [
        "operation:sip-operation-1",
        "provider-call:sip-call-[REDACTED_TARGET]",
        "participant:session-load-1:sip:sip-operation-1",
        "hangup:hangup-operation-1",
      ],
      asr: ["speech:speech-1"],
      mt: ["turn:turn-1"],
      tts: ["playback:playback-1:real-tts:tts-model"],
    });
    expect(JSON.stringify(result)).not.toContain(targetPhone);
    const dials = requests.filter((item) => item.url.endsWith("/sip-outbound"));
    expect(dials).toHaveLength(3);
    expect(dials.every((item) => item.body.targetPhone === targetPhone)).toBe(true);
    expect(requests.filter((item) => item.url.endsWith("/sip-hangup")))
      .toHaveLength(1);
    expect(runtime.disposed).toBe(true);
  });
});

describe("redactPhoneNumbers", () => {
  it("removes the selected target and other E.164 numbers", () => {
    expect(redactPhoneNumbers(
      "target=+8613800138000 fallback=+12025550123",
      "+8613800138000",
    )).toBe("target=[REDACTED_TARGET] fallback=[REDACTED_E164]");
  });

  it("removes a normalized Chinese target returned by an API", () => {
    expect(redactPhoneNumbers(
      "provider=sip-call-13800138000",
      "+8613800138000",
    )).toBe("provider=sip-call-[REDACTED_TARGET]");
  });
});

class FakeClock {
  now = 0;
  async sleep(ms) {
    this.now += ms;
  }
}

class FakeRtcRuntime {
  rooms = [];
  disposed = false;

  constructor() {
    const runtime = this;
    class Room extends EventEmitter {
      remoteParticipants = new Map([
        ["worker", { identity: "call-load-1:worker:translation" }],
        ["sip", { identity: "session-load-1:sip:sip-operation-1" }],
      ]);
      localParticipant = {
        identity: null,
        publishTrack: async (track) => {
          track.source.trackName = track.name;
          track.source.runtime = runtime;
          return { sid: "host-track" };
        },
      };
      constructor() {
        super();
        runtime.rooms.push(this);
      }
      async connect(_url, token) {
        this.localParticipant.identity = token;
      }
      async disconnect() {}
    }
    class AudioSource {
      emitted = false;
      async captureFrame() {
        if (this.emitted) return;
        this.emitted = true;
        this.runtime.emitTranslation();
      }
      clearQueue() {}
    }
    this.module = {
      Room,
      RoomEvent: { DataReceived: "data" },
      AudioSource,
      AudioFrame: class {},
      LocalAudioTrack: {
        createAudioTrack: (name, source) => ({ name, source, async close() {} }),
      },
      TrackPublishOptions: class {},
      TrackSource: { SOURCE_MICROPHONE: "microphone" },
      dispose: async () => {
        runtime.disposed = true;
      },
    };
  }

  emitTranslation() {
    const base = {
      segmentId: "segment-1",
      speechId: "speech-1",
      turnId: "turn-1",
      revision: 1,
      pipelineGeneration: 1,
      speakerRole: "host",
    };
    const events = [
      { ...base, type: "transcript.final" },
      { ...base, type: "translation.final" },
      { ...base, type: "tts.ready", provider: "real-tts", model: "tts-model" },
      {
        ...base,
        type: "playback.ended",
        playbackId: "playback-1",
        provider: "real-tts",
        model: "tts-model",
      },
    ];
    for (const room of this.rooms) {
      for (const event of events) {
        room.emit(
          "data",
          Buffer.from(JSON.stringify(event)),
          undefined,
          0,
          "translation.captions",
        );
      }
    }
  }
}

function fakeApi(requests) {
  let dialCount = 0;
  return async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, body, headers: init.headers });
    if (url.endsWith("/health")) return json({
      callRoomReadiness: { status: "ready" },
      pstnReadiness: { status: "ready", provider: "livekit_sip" },
    });
    if (url.endsWith("/call-links")) return json({
      callId: "call-load-1",
      sessionId: "session-load-1",
      roomName: "call_session-load-1",
    });
    if (url.endsWith("/room-token")) return json({
      wsUrl: "wss://livekit.example.cn",
      token: "host-rtc-token",
      participantIdentity: "call-load-1:host:1",
      participantRole: "host",
    });
    if (url.endsWith("/room-connected")) {
      return json({ status: "waiting", workerReady: false });
    }
    if (url.endsWith("/sip-outbound")) {
      dialCount += 1;
      return json({
        operationId: "sip-operation-1",
        status: dialCount < 3 ? "accepted" : "active",
        replayed: dialCount > 1,
        providerCallId: "sip-call-+8613800138000",
        ...(dialCount === 1
          ? { participantIdentity: "session-load-1:sip:sip-operation-1" }
          : {}),
      }, 202);
    }
    if (url.endsWith("/sip-hangup")) return json({
      operationId: "hangup-operation-1",
      status: "succeeded",
    }, 202);
    if (url.endsWith("/end")) return json({ status: "ended" });
    return json({ error: { code: "not_found", message: "not found" } }, 404);
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pcm(values) {
  const result = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => result.writeInt16LE(value, index * 2));
  return result;
}
