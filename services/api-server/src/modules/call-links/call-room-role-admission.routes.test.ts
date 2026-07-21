import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  setCallRoomDataPublisherForTests,
  type CallRoomDataPublisher,
} from "./call-room-worker.js";

describe("call room single-role admission", () => {
  beforeEach(() => {
    configureCallRoomEnv();
    resetStore();
  });

  afterEach(() => {
    setCallRoomDataPublisherForTests(null);
    clearCallRoomEnv();
  });

  it("rejects and removes a second live participant for the same role", async () => {
    const connected = new Set<string>();
    const removed: string[] = [];
    setCallRoomDataPublisherForTests({
      async ensureRoom() {},
      async hasParticipant(_roomName, participantIdentity) {
        return connected.has(participantIdentity);
      },
      async removeParticipant(_roomName, participantIdentity) {
        removed.push(participantIdentity);
        connected.delete(participantIdentity);
      },
      async publish() {},
    } satisfies CallRoomDataPublisher);
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    const firstToken = await hostToken(app, callId, "First");
    const duplicateToken = await hostToken(app, callId, "Duplicate");
    connected.add(firstToken.participantIdentity);
    connected.add(duplicateToken.participantIdentity);

    const first = await confirm(app, callId, firstToken);
    const duplicate = await confirm(app, callId, duplicateToken);
    await app.close();

    expect(first.statusCode).toBe(200);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe(
      "call_room_participant_role_in_use",
    );
    expect(removed).toEqual([duplicateToken.participantIdentity]);
    expect(getStoreSnapshot().sessions[0]?.callLegs?.filter(
      (leg) => leg.participantRole === "host" && leg.status === "active",
    )).toHaveLength(1);
  });

  it("replaces a persisted role leg after the previous participant left", async () => {
    const connected = new Set<string>();
    setCallRoomDataPublisherForTests({
      async ensureRoom() {},
      async hasParticipant(_roomName, participantIdentity) {
        return connected.has(participantIdentity);
      },
      async publish() {},
    } satisfies CallRoomDataPublisher);
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    const firstToken = await hostToken(app, callId, "First");
    const replacementToken = await hostToken(app, callId, "Replacement");
    connected.add(firstToken.participantIdentity);
    const first = await confirm(app, callId, firstToken);
    connected.delete(firstToken.participantIdentity);
    connected.add(replacementToken.participantIdentity);

    const replacement = await confirm(app, callId, replacementToken);
    await app.close();

    expect(first.statusCode).toBe(200);
    expect(replacement.statusCode).toBe(200);
    expect(getStoreSnapshot().sessions[0]?.callLegs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantIdentity: firstToken.participantIdentity,
          status: "ended",
        }),
        expect.objectContaining({
          participantIdentity: replacementToken.participantIdentity,
          status: "active",
        }),
      ]),
    );
  });
});

async function hostToken(
  app: Awaited<ReturnType<typeof buildApp>>,
  callId: string,
  participantName: string,
) {
  return (await app.inject({
    method: "POST",
    url: `/call-links/${callId}/room-token`,
    payload: { participantRole: "host", participantName },
  })).json() as Record<string, string>;
}

function confirm(
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
