import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

describe("session review routes", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usageBalances = {};
    store.usagePlanCodes = {};
    store.usageHolds = [];
    store.entitlementPlanCodes = {};
    store.entitlementOrderIds = {};
  });

  it("generates, persists, returns, and exports session review", async () => {
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
            id: "1",
            sourceText: "今天下午三点开会",
            translatedText: "Meeting at three this afternoon",
          },
          {
            id: "2",
            sourceText: "预算是2000元",
            translatedText: "The budget is 2000 yuan",
          },
          { id: "3", sourceText: "字幕", translatedText: "subtitles" },
        ],
      },
    });

    const reviewed = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/review`,
    });
    const detail = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    const exported = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/export?format=markdown`,
    });
    await app.close();

    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().review).toMatchObject({
      provider: "local",
      summary: expect.stringContaining("Meeting at three this afternoon"),
    });
    expect(reviewed.json().review.terms).toContainEqual({
      sourceText: "字幕",
      translatedText: "subtitles",
    });
    expect(detail.json().review.highlights.map((item: { type: string }) => item.type))
      .toContain("money");
    expect(exported.json().content).toContain("## Summary");
    expect(exported.json().content).toContain("## Terms");
  });

  it("falls back to a local review when OpenAI-compatible review is misconfigured", async () => {
    const previousProvider = process.env.SESSION_REVIEW_PROVIDER;
    process.env.SESSION_REVIEW_PROVIDER = "openai_compatible";
    try {
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
      const reviewed = await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/review`,
      });
      const detail = await app.inject({
        method: "GET",
        url: `/sessions/${sessionId}`,
      });
      await app.close();

      expect(reviewed.statusCode).toBe(200);
      expect(reviewed.json().review).toMatchObject({
        provider: "local",
        risks: [expect.stringContaining("LLM 纪要暂不可用")],
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().review.provider).toBe("local");
    } finally {
      if (previousProvider === undefined) {
        delete process.env.SESSION_REVIEW_PROVIDER;
      } else {
        process.env.SESSION_REVIEW_PROVIDER = previousProvider;
      }
    }
  });
});
