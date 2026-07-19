import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { runTranslationRoomLoadSession } from
  "./translation_room_load_session.mjs";

describe("translation room load session", () => {
  it("drives an authenticated real translation cycle and ends it cleanly", async () => {
    const clock = new FakeClock();
    const requests = [];
    const runtime = new FakeRtcRuntime(clock);
    const result = await runTranslationRoomLoadSession({
      root: process.cwd(),
      apiBaseUrl: "https://staging.example.cn",
      sessionId: "capacity-25-001",
      durationMs: 1000,
      accountToken: "account-secret",
      requestTimeoutMs: 1000,
      eventTimeoutMs: 1000,
      utteranceIntervalMs: 1000,
      endpointSilenceMs: 20,
      nowMs: () => clock.now,
      sleep: (ms) => clock.sleep(ms),
      readWav: () => ({ sampleRate: 1000, pcm: pcm([100, 200]) }),
      loadRtcNode: async () => runtime.module,
      fetchFn: fakeApi(requests),
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      status: "passed",
      environment: "staging",
      realProviderTraffic: true,
      observedDurationMs: 1000,
      trafficKinds: ["api", "livekit", "asr", "mt", "tts"],
      finalEventObserved: true,
      providerSideEffectDuplicates: 0,
      lostFinalEvents: 0,
      duplicateSettlements: 0,
      completedUtterances: 1,
      endedStatus: "ended",
    });
    expect(result.providerEvidence).toMatchObject({
      api: ["call:call-load-1", "session:session-load-1"],
      livekit: ["room:call_session-load-1"],
      asr: ["speech:speech-1"],
      mt: ["turn:turn-1"],
      tts: ["tts:real-tts:tts-model:segment-1"],
    });
    const protectedRequests = requests.filter((item) =>
      item.url.endsWith("/call-links") ||
      item.body?.participantRole === "host" ||
      item.url.endsWith("/end")
    );
    expect(protectedRequests.every((item) =>
      item.headers.authorization === "Bearer account-secret"
    )).toBe(true);
    expect(requests.at(-1).url).toContain("/call-links/call-load-1/end");
    expect(runtime.disposed).toBe(true);
  });

  it("fails when translated audio starts but playback terminates as failed", async () => {
    const clock = new FakeClock();
    const requests = [];
    const runtime = new FakeRtcRuntime(clock, "playback.failed");

    await expect(runTranslationRoomLoadSession({
      root: process.cwd(),
      apiBaseUrl: "https://staging.example.cn",
      sessionId: "capacity-failed-playback",
      durationMs: 1000,
      accountToken: "account-secret",
      requestTimeoutMs: 1000,
      eventTimeoutMs: 1000,
      utteranceIntervalMs: 1000,
      endpointSilenceMs: 20,
      nowMs: () => clock.now,
      sleep: (ms) => clock.sleep(ms),
      readWav: () => ({ sampleRate: 1000, pcm: pcm([100, 200]) }),
      loadRtcNode: async () => runtime.module,
      fetchFn: fakeApi(requests),
    })).rejects.toThrow("Translated target playback failed");

    expect(requests.at(-1).url).toContain("/call-links/call-load-1/end");
    expect(runtime.disposed).toBe(true);
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

  constructor(clock, playbackType = "playback.ended") {
    const runtime = this;
    this.playbackType = playbackType;
    class Room extends EventEmitter {
      remoteParticipants = new Map([
        ["worker", { identity: "call-load-1:worker:translation" }],
      ]);
      localParticipant = {
        identity: null,
        publishTrack: async (track) => {
          track.source.trackName = track.name;
          track.source.runtime = runtime;
          return { sid: `track-${runtime.rooms.indexOf(this)}` };
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
        this.runtime.emitTranslation(this.trackName);
      }
      clearQueue() {}
    }
    this.module = {
      Room,
      RoomEvent: { DataReceived: "data", TrackSubscribed: "track" },
      AudioSource,
      AudioStream: FakeAudioStream,
      AudioFrame: class {
        constructor(data) {
          this.data = data;
        }
      },
      LocalAudioTrack: {
        createAudioTrack: (name, source) => ({ name, source, async close() {} }),
      },
      TrackPublishOptions: class {},
      TrackSource: { SOURCE_MICROPHONE: "microphone" },
      dispose: async () => {
        runtime.disposed = true;
      },
    };
    this.clock = clock;
  }

  emitTranslation(trackName) {
    const sourceRole = trackName.includes("load-host-") ? "host" : "guest";
    const targetRole = sourceRole === "host" ? "guest" : "host";
    const base = {
      segmentId: "segment-1",
      speechId: "speech-1",
      turnId: "turn-1",
      revision: 1,
      pipelineGeneration: 1,
      speakerRole: sourceRole,
    };
    for (const room of this.rooms) {
      for (const event of [
        { ...base, type: "transcript.final" },
        { ...base, type: "translation.final" },
        { ...base, type: "tts.ready", provider: "real-tts", model: "tts-model" },
        { ...base, type: this.playbackType },
      ]) {
        room.emit(
          "data",
          Buffer.from(JSON.stringify(event)),
          undefined,
          0,
          "translation.captions",
        );
      }
      room.emit("track", {
        name: `translation-tts-${targetRole}-24000.dGFyZ2V0`,
      }, {
        name: `translation-tts-${targetRole}-24000.dGFyZ2V0`,
      });
    }
  }
}

class FakeAudioStream {
  getReader() {
    let read = false;
    return {
      async read() {
        if (read) return { done: true };
        read = true;
        return { done: false, value: { data: new Int16Array([1]) } };
      },
      async cancel() {},
      releaseLock() {},
    };
  }
}

function fakeApi(requests) {
  return async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, body, headers: init.headers });
    if (url.endsWith("/health")) {
      return json({ callRoomReadiness: { status: "ready" } });
    }
    if (url.endsWith("/call-links")) {
      return json({
        callId: "call-load-1",
        sessionId: "session-load-1",
        roomName: "call_session-load-1",
        joinUrl: "https://join.example.cn/join/call-load-1?ticket=guest-ticket",
      });
    }
    if (url.endsWith("/room-token")) {
      return json({
        wsUrl: "wss://livekit.example.cn",
        token: `${body.participantRole}-rtc-token`,
        participantIdentity: `call-load-1:${body.participantRole}:1`,
        participantRole: body.participantRole,
      });
    }
    if (url.endsWith("/room-connected")) {
      return json(body.participantRole === "guest"
        ? { status: "waiting", workerReady: false }
        : { status: "active", workerReady: true });
    }
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
