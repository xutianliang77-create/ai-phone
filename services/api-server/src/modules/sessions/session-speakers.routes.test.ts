import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

const secret = "internal-secret-123";

describe("session speaker routes", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = secret;
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usageBalances = {};
    store.usagePlanCodes = {};
    store.usageHolds = [];
    store.billingLedger = [];
  });

  afterEach(() => delete process.env.INTERNAL_API_SECRET);

  it("persists, lists, renames, reviews, and exports one speaker identity", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/realtime/sessions",
      payload: {
        mode: "conversation",
        sourceLanguage: "auto",
        targetLanguage: "zh",
        voiceOutput: false,
      },
    });
    const sessionId = created.json().sessionId as string;
    await app.inject({
      method: "POST",
      url: "/internal/realtime/segments",
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        sessionId,
        segmentId: "seg_1",
        sourceText: "good morning",
        sourceLanguage: "en",
        speaker: {
          speakerId: "speaker_1",
          role: "speaker",
          source: "diarization",
          confidence: 0.88,
        },
        timing: { startMs: 1000, endMs: 1800, source: "client" },
      },
    });

    const speakers = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/speakers`,
    });
    const renamed = await app.inject({
      method: "PATCH",
      url: `/sessions/${sessionId}/speakers/speaker_1`,
      payload: { displayName: "客户" },
    });
    const markdown = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/export?format=markdown`,
    });
    const csv = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/export?format=csv`,
    });
    await app.close();

    expect(speakers.json().speakers).toMatchObject([{
      speaker: { speakerId: "speaker_1" },
      segmentCount: 1,
      totalDurationMs: 800,
    }]);
    expect(renamed.json().segments[0].speaker.displayName).toBe("客户");
    expect(markdown.json().content).toContain("Speaker: 客户");
    expect(csv.json().content).toContain(
      '"speaker_1","speaker","客户","diarization","1000","1800"',
    );
  });

  it("rejects a missing rename body without crashing", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/realtime/sessions",
      payload: {
        mode: "conversation",
        sourceLanguage: "auto",
        targetLanguage: "zh",
        voiceOutput: false,
      },
    });
    const response = await app.inject({
      method: "PATCH",
      url: `/sessions/${created.json().sessionId}/speakers/speaker_1`,
      payload: {},
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_speaker_name");
  });
});
