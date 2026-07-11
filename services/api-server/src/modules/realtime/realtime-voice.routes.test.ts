import { describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { verifyRealtimeToken } from "./realtime-token.js";

describe("realtime voice output", () => {
  it("issues realtime tokens with ready voice profile config", async () => {
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usageBalances = {};
    store.usagePlanCodes = {};
    store.usageHolds = [];
    store.voiceProfiles = [{
      id: "voice_1",
      userId: "guest-user",
      displayName: "我的声音",
      status: "ready",
      voiceMode: "personal_clone",
      consentVersion: "domestic-voice-profile-v1",
      consentAcceptedAt: "2026-07-10T00:00:00.000Z",
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
      referenceAudioId: "voice_1",
      referenceTranscript: "你好，我正在创建我的声音。",
    }];

    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/realtime/sessions",
      payload: {
        mode: "conversation",
        sourceLanguage: "zh",
        targetLanguage: "en",
        voiceOutput: true,
        voice: {
          mode: "personal_clone",
          voiceProfileId: "client_supplied",
          referenceAudioId: "client_supplied",
        },
      },
    });
    await app.close();

    expect(created.statusCode).toBe(200);
    const claims = verifyRealtimeToken(created.json().realtimeToken, "dev-secret");
    expect(claims?.voice).toMatchObject({
      mode: "ultimate_clone",
      voiceProfileId: "voice_1",
      referenceAudioId: "voice_1",
      referenceTranscript: "你好，我正在创建我的声音。",
    });
  });
});
