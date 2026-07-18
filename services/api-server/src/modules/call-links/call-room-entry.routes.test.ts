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

  it("starts the Worker only after host and guest confirm LiveKit connection", async () => {
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
    const hostTokenResponse = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/room-token`,
      payload: { participantRole: "host", participantName: "Host" },
    });
    const hostToken = hostTokenResponse.json();
    const payload = decodeJwtPayload(hostToken.token);
    expect(hostTokenResponse.statusCode).toBe(200);
    expect(hostToken).toMatchObject({
      callId,
      provider: "livekit",
      participantRole: "host",
      roomName: `call_${callId}`,
      wsUrl: "wss://livekit.example.cn",
      fullDuplexEnabled: true,
    });
    expect(JSON.parse(payload.metadata)).toMatchObject({
      callId,
      participantRole: "host",
      fullDuplexEnabled: true,
    });
    expect(payload.iss).toBe("lk_key");
    expect(payload.video).toMatchObject({
      room: `call_${callId}`,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
    expect(ensuredRooms).toEqual([`call_${callId}`]);
    expect(workerRuntime.ensuredCallIds).toEqual([]);
    expect(getStoreSnapshot().sessions[0]?.callLegs).toEqual([]);

    const hostConnected = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/room-connected`,
      payload: connectionConfirmation(hostToken),
    });
    expect(hostConnected.statusCode).toBe(200);
    expect(hostConnected.json()).toMatchObject({
      status: "waiting",
      workerReady: false,
    });
    expect(workerRuntime.ensuredCallIds).toEqual([]);
    expect(getStoreSnapshot().sessions[0]?.callLegs).toMatchObject([{
      id: hostToken.participantIdentity,
      participantIdentity: hostToken.participantIdentity,
      participantRole: "host",
      joinType: "app",
      status: "active",
    }]);

    const waitingLink = await app.inject({
      method: "GET",
      url: `/call-links/${callId}`,
    });
    expect(waitingLink.json().status).toBe("created");
    const guestTokenResponse = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/room-token`,
      payload: {
        participantRole: "guest",
        participantName: "Guest",
        guestTicket: guestTicketFrom(created),
      },
    });
    const guestToken = guestTokenResponse.json();
    const guestConnected = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/room-connected`,
      payload: connectionConfirmation(guestToken),
    });
    await app.close();

    expect(guestConnected.statusCode).toBe(200);
    expect(guestConnected.json()).toMatchObject({
      status: "active",
      workerReady: true,
    });
    expect(workerRuntime.ensuredCallIds).toEqual([callId]);
    expect(getStoreSnapshot().sessions[0]?.callLegs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ participantRole: "host", status: "active" }),
        expect.objectContaining({ participantRole: "guest", status: "active" }),
      ]),
    );
  });

  it("allows the Worker to register its leg while participant entry is pending", async () => {
    configureCallRoomEnv();
    setCallRoomDataPublisherForTests({
      async ensureRoom() {},
      async publish() {},
    } satisfies CallRoomDataPublisher);
    let registerWorker!: (callId: string) => Promise<void>;
    workerRuntime = new RecordingWorkerRuntime(async (callId) => {
      await registerWorker(callId);
    });
    setCallLinkWorkerSupervisorForTests(workerRuntime);
    const app = await buildApp();
    registerWorker = async (callId) => {
      const response = await app.inject({
        method: "POST",
        url: `/internal/call-links/${callId}/worker-room-token`,
        headers: { authorization: "Bearer internal-secret-123" },
        payload: { callId },
      });
      expect(response.statusCode).toBe(200);
    };
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;

    const hostToken = (await app.inject({
      method: "POST",
      url: `/call-links/${callId}/room-token`,
      payload: { participantRole: "host", participantName: "Host" },
    })).json();
    const guestToken = (await app.inject({
      method: "POST",
      url: `/call-links/${callId}/room-token`,
      payload: {
        participantRole: "guest",
        participantName: "Guest",
        guestTicket: guestTicketFrom(created),
      },
    })).json();
    await app.inject({
      method: "POST",
      url: `/call-links/${callId}/room-connected`,
      payload: connectionConfirmation(hostToken),
    });
    const response = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/room-connected`,
      payload: connectionConfirmation(guestToken),
    });
    const duplicate = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/room-connected`,
      payload: connectionConfirmation(guestToken),
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(duplicate.statusCode).toBe(200);
    expect(workerRuntime.ensuredCallIds).toEqual([callId]);
    expect(getStoreSnapshot().sessions[0]?.callLegs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ participantRole: "worker", status: "active" }),
        expect.objectContaining({ participantRole: "host", status: "active" }),
      ]),
    );
  });

  it("rejects a connection confirmation bound to another call", async () => {
    configureCallRoomEnv();
    setCallRoomDataPublisherForTests({
      async ensureRoom() {},
      async publish() {},
    } satisfies CallRoomDataPublisher);
    const app = await buildApp();
    const first = await app.inject({ method: "POST", url: "/call-links" });
    const second = await app.inject({ method: "POST", url: "/call-links" });
    const token = (await app.inject({
      method: "POST",
      url: `/call-links/${first.json().callId}/room-token`,
      payload: {
        participantRole: "guest",
        guestTicket: guestTicketFrom(first),
      },
    })).json();

    const response = await app.inject({
      method: "POST",
      url: `/call-links/${second.json().callId}/room-connected`,
      payload: connectionConfirmation(token),
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("invalid_call_room_token");
    expect(workerRuntime.ensuredCallIds).toEqual([]);
  });

  it("rejects entry when LiveKit is not configured", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const response = await app.inject({
      method: "POST",
      url: `/call-links/${created.json().callId}/room-token`,
      payload: {
        participantRole: "guest",
        guestTicket: guestTicketFrom(created),
      },
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
  constructor(
    private readonly onEnsure?: (callId: string) => Promise<void>,
  ) {}
  async ensure(callId: string) {
    this.ensuredCallIds.push(callId);
    await this.onEnsure?.(callId);
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
  "CALL_FULL_DUPLEX_ENABLED",
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
  process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "120";
  process.env.INTERNAL_API_SECRET = "internal-secret-123";
  process.env.CALL_FULL_DUPLEX_ENABLED = "true";
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

function connectionConfirmation(token: Record<string, string>) {
  return {
    participantIdentity: token.participantIdentity,
    participantRole: token.participantRole,
    token: token.token,
  };
}

function guestTicketFrom(response: { json(): Record<string, unknown> }) {
  const joinUrl = String(response.json().joinUrl ?? "");
  return new URL(joinUrl).searchParams.get("ticket") ?? "";
}
