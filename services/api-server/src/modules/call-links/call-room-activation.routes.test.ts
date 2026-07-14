import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  setCallLinkWorkerSupervisorForTests,
  type CallLinkWorkerRuntime,
} from "./call-link-worker-supervisor.js";
import {
  setCallRoomDataPublisherForTests,
  type CallRoomDataPublisher,
} from "./call-room-worker.js";

describe("call room activation barrier", () => {
  let workerRuntime: RecordingWorkerRuntime;

  beforeEach(() => {
    configureCallRoomEnv();
    resetStore();
    workerRuntime = new RecordingWorkerRuntime();
    setCallLinkWorkerSupervisorForTests(workerRuntime);
  });

  afterEach(() => {
    setCallRoomDataPublisherForTests(null);
    setCallLinkWorkerSupervisorForTests(null);
    clearCallRoomEnv();
  });

  it("serializes concurrent host and guest confirmations by callId", async () => {
    setCallRoomDataPublisherForTests(connectedPublisher());
    let registerWorker!: (callId: string) => Promise<void>;
    workerRuntime = new RecordingWorkerRuntime(registerWorkerCall =>
      registerWorker(registerWorkerCall));
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
    const callId = (await app.inject({ method: "POST", url: "/call-links" }))
      .json().callId as string;
    const [hostToken, guestToken] = await Promise.all([
      roomToken(app, callId, "host"),
      roomToken(app, callId, "guest"),
    ]);

    const responses = await Promise.all([
      confirmConnection(app, callId, hostToken),
      confirmConnection(app, callId, guestToken),
    ]);
    await app.close();

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(workerRuntime.ensuredCallIds).toEqual([callId]);
    const humanLegs = getStoreSnapshot().sessions[0]?.callLegs?.filter(
      (leg) => leg.participantRole !== "worker",
    );
    expect(humanLegs).toHaveLength(2);
    expect(new Set(humanLegs?.map((leg) => leg.participantRole))).toEqual(
      new Set(["host", "guest"]),
    );
  });

  it("does not activate a participant missing from the LiveKit room", async () => {
    setCallRoomDataPublisherForTests({
      async ensureRoom() {},
      async hasParticipant() {
        return false;
      },
      async publish() {},
    } satisfies CallRoomDataPublisher);
    const app = await buildApp();
    const callId = (await app.inject({ method: "POST", url: "/call-links" }))
      .json().callId as string;
    const token = await roomToken(app, callId, "guest");

    const response = await confirmConnection(app, callId, token);
    await app.close();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe(
      "call_room_participant_not_connected",
    );
    expect(getStoreSnapshot().sessions[0]?.callLegs).toEqual([]);
    expect(workerRuntime.ensuredCallIds).toEqual([]);
  });
});

class RecordingWorkerRuntime implements CallLinkWorkerRuntime {
  readonly ensuredCallIds: string[] = [];
  constructor(private readonly onEnsure?: (callId: string) => Promise<void>) {}
  async ensure(callId: string) {
    this.ensuredCallIds.push(callId);
    await this.onEnsure?.(callId);
  }
  markReady() {}
  stop() {}
  shutdown() {}
}

function connectedPublisher(): CallRoomDataPublisher {
  return {
    async ensureRoom() {},
    async hasParticipant() {
      return true;
    },
    async publish() {},
  };
}

async function roomToken(app: Awaited<ReturnType<typeof buildApp>>, callId: string, role: string) {
  return (await app.inject({
    method: "POST",
    url: `/call-links/${callId}/room-token`,
    payload: { participantRole: role },
  })).json() as Record<string, string>;
}

function confirmConnection(
  app: Awaited<ReturnType<typeof buildApp>>,
  callId: string,
  token: Record<string, string>,
) {
  return app.inject({
    method: "POST",
    url: `/call-links/${callId}/room-connected`,
    payload: {
      participantIdentity: token.participantIdentity,
      participantRole: token.participantRole,
      token: token.token,
    },
  });
}

function configureCallRoomEnv() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "lk_key";
  process.env.LIVEKIT_API_SECRET = "lk_secret";
  process.env.INTERNAL_API_SECRET = "internal-secret-123";
}

function clearCallRoomEnv() {
  for (const key of [
    "CALL_ROOM_PROVIDER",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "INTERNAL_API_SECRET",
  ]) delete process.env[key];
}

function resetStore() {
  const store = getStoreSnapshot();
  store.sessions = [];
  store.usageBalances = {};
  store.usageHolds = [];
  store.billingLedger = [];
}
