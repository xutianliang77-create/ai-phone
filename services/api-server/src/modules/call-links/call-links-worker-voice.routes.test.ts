import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

describe("call link worker voice route", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    configureCallRoomEnv();
    resetStore();
  });

  afterEach(() => {
    restoreEnv(previousEnv);
  });

  it("returns the host ready voice profile to translation workers", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/voice-profiles/me",
      payload: {
        displayName: "我的声音",
        consentAccepted: true,
        consentVersion: "domestic-voice-profile-v1",
        referenceAudioId: "voice_ref_1",
        referenceTranscript: "你好，我正在创建我的声音。",
      },
    });
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    const response = await app.inject({
      method: "POST",
      url: `/internal/call-links/${callId}/worker-room-token`,
      headers: { authorization: "Bearer internal-secret-123" },
      payload: { participantName: "translation-worker" },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      callId,
      sessionId: callId,
      ttsVoice: {
        mode: "ultimate_clone",
        referenceAudioId: "voice_ref_1",
        referenceTranscript: "你好，我正在创建我的声音。",
      },
    });
    expect(response.json().ttsVoice.voiceProfileId).toEqual(expect.any(String));
  });
});

const envKeys = [
  "CALL_ROOM_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "CALL_ROOM_TOKEN_TTL_SECONDS",
  "INTERNAL_API_SECRET",
];

function configureCallRoomEnv() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "lk_key";
  process.env.LIVEKIT_API_SECRET = "lk_secret";
  process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "3600";
  process.env.INTERNAL_API_SECRET = "internal-secret-123";
}

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function resetStore() {
  const store = getStoreSnapshot();
  store.sessions = [];
  store.usageBalances = {};
  store.usagePlanCodes = {};
  store.usageHolds = [];
  store.voiceProfiles = [];
}
