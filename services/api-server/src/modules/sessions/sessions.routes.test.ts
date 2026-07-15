import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

describe("sessions routes", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usageBalances = {};
    store.usagePlanCodes = {};
    store.usageHolds = [];
    store.entitlementPlanCodes = {};
    store.entitlementOrderIds = {};
  });

  it("merges app-saved segments without dropping gateway-owned history", async () => {
    const previousSecret = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = "internal-secret-123";
    try {
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
      const authorization = { authorization: "Bearer internal-secret-123" };

      await app.inject({
        method: "POST",
        url: "/internal/realtime/segments",
        headers: authorization,
        payload: {
          sessionId,
          segmentId: "seg_1",
          sourceText: "Hello, this is an online translation test.",
          rawText: "Hello, this is an online translation test.",
          translatedText: "你好，这是在线翻译测试。",
          sourceLanguage: "en",
          targetLanguage: "zh",
          stage: "translation",
          provider: "hymt2_self_hosted",
          model: "tencent/Hy-MT2-1.8B",
          latencyMs: 100,
        },
      });
      await app.inject({
        method: "POST",
        url: "/internal/realtime/segments",
        headers: authorization,
        payload: {
          sessionId,
          segmentId: "seg_2",
          sourceText: "What is your name?",
          translatedText: "你叫什么名字？",
          sourceLanguage: "en",
          targetLanguage: "zh",
          stage: "translation",
          provider: "hymt2_self_hosted",
          model: "tencent/Hy-MT2-1.8B",
        },
      });

      await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/segments`,
        payload: {
          segments: [
            {
              id: "seg_1",
              sourceText: "你好，这是在线翻译测试。",
              translatedText: "你好，这是在线翻译测试。",
              sourceLanguage: "zh",
              targetLanguage: "zh",
            },
          ],
        },
      });
      const detail = await app.inject({
        method: "GET",
        url: `/sessions/${sessionId}`,
      });
      await app.close();

      expect(detail.statusCode).toBe(200);
      expect(detail.json().segments).toHaveLength(2);
      expect(detail.json().segments[0]).toMatchObject({
        id: "seg_1",
        sourceText: "Hello, this is an online translation test.",
        rawText: "Hello, this is an online translation test.",
        translatedText: "你好，这是在线翻译测试。",
        sourceLanguage: "en",
        targetLanguage: "zh",
        provider: "hymt2_self_hosted",
      });
      expect(detail.json().segments[1]).toMatchObject({
        id: "seg_2",
        sourceText: "What is your name?",
        translatedText: "你叫什么名字？",
      });
    } finally {
      if (previousSecret === undefined) {
        delete process.env.INTERNAL_API_SECRET;
      } else {
        process.env.INTERNAL_API_SECRET = previousSecret;
      }
    }
  });

  it("returns productized list metadata for scan sessions", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/realtime/sessions",
      payload: {
        mode: "meeting",
        sourceLanguage: "zh",
        targetLanguage: "en",
        voiceOutput: false,
      },
    });
    const sessionId = created.json().sessionId as string;
    await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/segments`,
      payload: {
        segments: [
          {
            id: "scan_1",
            sourceText: "菜单翻译",
            translatedText: "Menu translation",
            sourceLanguage: "zh",
            targetLanguage: "en",
            provider: "scan",
            speaker: { speakerId: "speaker_1" },
          },
        ],
      },
    });

    const list = await app.inject({ method: "GET", url: "/sessions" });
    await app.close();

    expect(list.statusCode).toBe(200);
    expect(list.json().sessions[0]).toMatchObject({
      sessionId,
      kind: "scan",
      title: "菜单翻译",
      sourceLanguage: "zh",
      targetLanguage: "en",
      speakerCount: 1,
    });
  });
});
