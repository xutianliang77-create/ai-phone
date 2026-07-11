import { describe, expect, it } from "vitest";
import { checkLiveKitRoomMediaReadiness } from "./livekit_room_media_readiness.mjs";

describe("checkLiveKitRoomMediaReadiness", () => {
  it("connects host, guest, and worker through data and audio media", async () => {
    const result = await checkLiveKitRoomMediaReadiness({
      apiBaseUrl: "http://127.0.0.1:3410",
      internalApiSecret: "internal-secret-123",
      timeoutMs: 100,
      fetchFn: fakeFetch,
      loadRtcNode: async () => createFakeRtcNode(),
    });

    expect(result.status).toBe("ready");
    expect(result.callId).toBe("call_1");
    expect(check(result, "participants_joined_room").status).toBe("pass");
    expect(check(result, "data_channel_received").status).toBe("pass");
    expect(check(result, "worker_audio_subscribed")).toMatchObject({
      status: "pass",
      details: {
        sampleRate: 16000,
        samples: 160,
        fromRole: "guest",
      },
    });
    expect(check(result, "guest_translation_tts_audio_subscribed")).toMatchObject({
      status: "pass",
      details: {
        sampleRate: 16000,
        samples: 160,
        fromRole: "worker",
        trackName: "translation-tts-guest-16000",
      },
    });
  });

  it("reports API LiveKit readiness failures", async () => {
    const result = await checkLiveKitRoomMediaReadiness({
      apiBaseUrl: "http://127.0.0.1:3410",
      internalApiSecret: "internal-secret-123",
      timeoutMs: 100,
      fetchFn: async (url) => jsonResponse(url.endsWith("/health")
        ? { service: "api-server", callRoomReadiness: { status: "not_ready" } }
        : {}),
      loadRtcNode: async () => createFakeRtcNode(),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "API callRoomReadiness is not ready for LiveKit media.",
    );
  });
});

function check(result, name) {
  return result.checks.find((item) => item.name === name);
}

async function fakeFetch(url, init = {}) {
  const path = new URL(url).pathname;
  if (path === "/health") {
    return jsonResponse({
      service: "api-server",
      callRoomReadiness: { status: "ready", provider: "livekit" },
    });
  }
  if (path === "/call-links" && init.method === "POST") {
    return jsonResponse({
      callId: "call_1",
      sessionId: "call_1",
      roomName: "call_call_1",
    });
  }
  if (path.endsWith("/room-token") && init.method === "POST") {
    const body = JSON.parse(init.body);
    return jsonResponse(roomToken(body.participantRole));
  }
  if (path.endsWith("/worker-room-token") && init.method === "POST") {
    return jsonResponse(roomToken("worker"));
  }
  return jsonResponse({ error: { message: "not found" } }, 404);
}

function roomToken(role) {
  return {
    callId: "call_1",
    sessionId: "call_1",
    provider: "livekit",
    roomName: "call_call_1",
    wsUrl: "ws://livekit.example.cn",
    participantRole: role,
    token: role,
    expiresAt: "2026-07-05T01:00:00.000Z",
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function createFakeRtcNode() {
  const connectedRooms = [];
  class Room {
    localParticipant = null;
    listeners = new Map();

    on(event, listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }

    async connect(_url, token) {
      this.localParticipant = new LocalParticipant(token, this, connectedRooms);
      connectedRooms.push(this);
    }

    async disconnect() {
      const index = connectedRooms.indexOf(this);
      if (index >= 0) connectedRooms.splice(index, 1);
    }

    emit(event, ...args) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
  }

  class LocalParticipant {
    constructor(role, room, rooms) {
      this.role = role;
      this.room = room;
      this.rooms = rooms;
      this.identity = `call_1:${role}:fake`;
    }

    async publishData(data) {
      for (const room of this.rooms) {
        if (room === this.room) continue;
        room.emit("dataReceived", data, this);
      }
    }

    async publishTrack(track) {
      const remoteParticipant = {
        identity: this.identity,
        metadata: JSON.stringify({ participantRole: this.role }),
      };
      const publication = {
        name: track?.name,
        trackName: track?.name,
      };
      for (const room of this.rooms) {
        if (room === this.room) continue;
        room.emit("trackSubscribed", track, publication, remoteParticipant);
      }
    }
  }

  class AudioStream extends ReadableStream {
    constructor() {
      super({
        start(controller) {
          controller.enqueue({
            data: new Int16Array(160),
            sampleRate: 16000,
          });
          controller.close();
        },
      });
    }
  }

  class AudioSource {
    async captureFrame(_frame) {}
    async waitForPlayout() {}
  }

  class AudioFrame {
    constructor(data, sampleRate) {
      this.data = data;
      this.sampleRate = sampleRate;
    }
  }

  return {
    Room,
    RoomEvent: {
      DataReceived: "dataReceived",
      TrackSubscribed: "trackSubscribed",
    },
    AudioStream,
    AudioFrame,
    AudioSource,
    LocalAudioTrack: {
      createAudioTrack: (name, source) => ({
        name,
        source,
        async close() {},
      }),
    },
    TrackPublishOptions: class {},
    TrackSource: { SOURCE_MICROPHONE: "microphone" },
    async dispose() {},
  };
}
