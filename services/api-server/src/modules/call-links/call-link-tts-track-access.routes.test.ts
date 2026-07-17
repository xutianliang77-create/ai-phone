import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { registerCallLeg } from "./call-links.service.js";
import { setLiveKitTtsTrackAccessControllerForTests } from "./call-link-tts-track-access.routes.js";

describe("internal TTS track access route", () => {
  let previousEnv: Record<string, string | undefined>;
  const authorize = vi.fn(async () => ({ participantCount: 3 }));

  beforeEach(() => {
    previousEnv = captureEnv();
    configureEnv();
    resetStore();
    authorize.mockClear();
    setLiveKitTtsTrackAccessControllerForTests({ authorize });
  });

  afterEach(() => {
    setLiveKitTtsTrackAccessControllerForTests(null);
    restoreEnv(previousEnv);
  });

  it("authorizes only an active Worker, active target leg, and bound track", async () => {
    const app = await buildApp();
    const call = await createCallWithLegs(app);
    const trackName = trackNameFor(call.guestIdentity);

    const response = await app.inject({
      method: "POST",
      url: `/internal/call-links/${call.callId}/tts-track-access`,
      headers: { authorization: `Bearer ${internalSecret}` },
      payload: {
        workerIdentity: call.workerIdentity,
        targetLegId: call.guestIdentity,
        targetSpeakerRole: "guest",
        trackSid: "TR_1",
        trackName,
      },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "authorized",
      participantCount: 3,
    });
    expect(authorize).toHaveBeenCalledWith({
      roomName: call.roomName,
      workerIdentity: call.workerIdentity,
      targetLegId: call.guestIdentity,
      trackSid: "TR_1",
      trackName,
    });
  });

  it("rejects a target-leg token mismatch before contacting LiveKit", async () => {
    const app = await buildApp();
    const call = await createCallWithLegs(app);

    const response = await app.inject({
      method: "POST",
      url: `/internal/call-links/${call.callId}/tts-track-access`,
      headers: { authorization: `Bearer ${internalSecret}` },
      payload: {
        workerIdentity: call.workerIdentity,
        targetLegId: call.guestIdentity,
        targetSpeakerRole: "guest",
        trackSid: "TR_1",
        trackName: "translation-tts-guest-24000.tampered",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe(
      "tts_track_access_binding_conflict",
    );
    expect(authorize).not.toHaveBeenCalled();
  });
});

async function createCallWithLegs(
  app: Awaited<ReturnType<typeof buildApp>>,
) {
  const created = await app.inject({ method: "POST", url: "/call-links" });
  const body = created.json();
  const callId = body.callId as string;
  const hostIdentity = `${callId}:host:host-1`;
  const workerIdentity = `${callId}:worker:worker-1`;
  const guestIdentity = `${callId}:guest:sip:op-1`;
  await registerCallLeg({
    callId,
    participantIdentity: hostIdentity,
    participantRole: "host",
    joinType: "app",
  });
  await registerCallLeg({
    callId,
    participantIdentity: workerIdentity,
    participantRole: "worker",
    joinType: "worker",
  });
  await registerCallLeg({
    callId,
    participantIdentity: guestIdentity,
    participantRole: "guest",
    joinType: "sip",
  });
  return {
    callId,
    roomName: body.roomName as string,
    workerIdentity,
    guestIdentity,
  };
}

function trackNameFor(identity: string) {
  return `translation-tts-guest-24000.${
    Buffer.from(identity).toString("base64url")
  }`;
}

const internalSecret = "internal-secret-123456789";
const envKeys = [
  "CALL_ROOM_PROVIDER",
  "INTERNAL_API_SECRET",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_URL",
];

function configureEnv() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.INTERNAL_API_SECRET = internalSecret;
  process.env.LIVEKIT_API_KEY = "livekit_key";
  process.env.LIVEKIT_API_SECRET = "livekit_secret_123456789012345678";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
}

function resetStore() {
  const store = getStoreSnapshot();
  store.accounts = [];
  store.sessions = [];
  store.usageBalances = {};
  store.usageHolds = [];
  store.billingLedger = [];
  store.providerOperations = [];
  store.inboxEvents = [];
  store.outboxEvents = [];
}

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
