import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  setCallRoomDataPublisherForTests,
  type CallRoomDataPublisher,
} from "./call-room-worker.js";
import {
  setCallLinkWorkerSupervisorForTests,
  type CallLinkWorkerRuntime,
} from "./call-link-worker-supervisor.js";

describe("call room entry routes", () => {
  let previousEnv: Record<string, string | undefined>;
  let workerRuntime: RecordingWorkerRuntime;

  beforeEach(() => {
    previousEnv = captureEnv();
    clearEnv();
    resetStore();
    workerRuntime = new RecordingWorkerRuntime();
    setCallLinkWorkerSupervisorForTests(workerRuntime);
  });

  afterEach(() => {
    setCallRoomDataPublisherForTests(null);
    setCallLinkWorkerSupervisorForTests(null);
    restoreEnv(previousEnv);
  });

  it("creates the room and Worker only when the first participant enters", async () => {
    configureCallRoomEnv();
    const ensuredRooms: string[] = [];
    setCallRoomDataPublisherForTests({
      async ensureRoom(roomName) {
        ensuredRooms.push(roomName);
      },
      async publish() {},
    } satisfies CallRoomDataPublisher);
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;

    expect(ensuredRooms).toEqual([]);
    expect(workerRuntime.ensuredCallIds).toEqual([]);
    const response = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/room-token`,
      payload: { participantRole: "host", participantName: "Host" },
    });
    await app.close();

    const body = response.json();
    const payload = decodeJwtPayload(body.token);
    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      callId,
      provider: "livekit",
      participantRole: "host",
      roomName: `call_${callId}`,
      wsUrl: "wss://livekit.example.cn",
    });
    expect(payload.iss).toBe("lk_key");
    expect(payload.video).toMatchObject({
      room: `call_${callId}`,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
    expect(ensuredRooms).toEqual([`call_${callId}`]);
    expect(workerRuntime.ensuredCallIds).toEqual([callId]);
  });

  it("rejects entry when LiveKit is not configured", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const response = await app.inject({
      method: "POST",
      url: `/call-links/${created.json().callId}/room-token`,
      payload: { participantRole: "guest" },
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe(
      "call_room_provider_not_configured",
    );
  });

  it("rejects invalid room participant roles", async () => {
    configureCallRoomEnv();
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const response = await app.inject({
      method: "POST",
      url: `/call-links/${created.json().callId}/room-token`,
      payload: { participantRole: "speaker" },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_call_room_participant");
  });
});

class RecordingWorkerRuntime implements CallLinkWorkerRuntime {
  readonly ensuredCallIds: string[] = [];
  async ensure(callId: string) {
    this.ensuredCallIds.push(callId);
  }
  markReady() {}
  stop() {}
  shutdown() {}
}

const envKeys = [
  "CALL_ROOM_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "CALL_ROOM_TOKEN_TTL_SECONDS",
  "INTERNAL_API_SECRET",
];

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function clearEnv() {
  for (const key of envKeys) delete process.env[key];
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function configureCallRoomEnv() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "lk_key";
  process.env.LIVEKIT_API_SECRET = "lk_secret";
  process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "3600";
  process.env.INTERNAL_API_SECRET = "internal-secret-123";
}

function resetStore() {
  const store = getStoreSnapshot();
  store.sessions = [];
  store.usageBalances = {};
  store.usageHolds = [];
  store.billingLedger = [];
}

function decodeJwtPayload(token: string) {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}
