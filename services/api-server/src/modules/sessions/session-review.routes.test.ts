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
    expect(
      detail
        .json()
        .review.highlights.map((item: { type: string }) => item.type),
    ).toContain("money");
    expect(exported.json().content).toContain("## Summary");
    expect(exported.json().content).toContain("## Terms");
  });

  it("requires an explicit public request and reuses its unchanged source result", async () => {
    const previousProvider = process.env.LLM_PROVIDER;
    const previousEnabled = process.env.LLM_REVIEW_ENABLED;
    process.env.LLM_PROVIDER = "mock";
    process.env.LLM_REVIEW_ENABLED = "true";
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
      await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/segments`,
        payload: {
          segments: [{
            id: "source_1",
            sourceText: "请发送会议纪要",
            translatedText: "Please send the meeting notes",
          }],
        },
      });

      const invalid = await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/review`,
        payload: { generationKind: "device_rules" },
      });
      const first = await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/review`,
        payload: { generationKind: "public_semantic_enhancement" },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/review`,
        payload: { generationKind: "public_semantic_enhancement" },
      });
      await app.close();

      expect(invalid.statusCode).toBe(400);
      expect(first.statusCode).toBe(200);
      expect(first.json().review).toMatchObject({
        generationKind: "public_semantic_enhancement",
        evidenceSegmentIds: ["source_1"],
        sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().review.generatedAt)
        .toBe(first.json().review.generatedAt);
    } finally {
      if (previousProvider === undefined) {
        delete process.env.LLM_PROVIDER;
      } else {
        process.env.LLM_PROVIDER = previousProvider;
      }
      if (previousEnabled === undefined) {
        delete process.env.LLM_REVIEW_ENABLED;
      } else {
        process.env.LLM_REVIEW_ENABLED = previousEnabled;
      }
    }
  });

  it("does not replace an explicit public request with local server rules", async () => {
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
    const response = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/review`,
      payload: { generationKind: "public_semantic_enhancement" },
    });
    await app.close();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("public_semantic_review_unavailable");
  });

  it("never selects the legacy review provider for a versioned public session", async () => {
    const previousProvider = process.env.LLM_PROVIDER;
    const previousEnabled = process.env.LLM_REVIEW_ENABLED;
    process.env.LLM_PROVIDER = "mock";
    process.env.LLM_REVIEW_ENABLED = "true";
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
      const record = getStoreSnapshot().sessions.find((item) => item.id === sessionId)!;
      record.processingAuthorization = {} as typeof record.processingAuthorization;

      const response = await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/review`,
        payload: { generationKind: "public_semantic_enhancement" },
      });
      await app.close();

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("public_semantic_review_not_configured");
    } finally {
      if (previousProvider === undefined) delete process.env.LLM_PROVIDER;
      else process.env.LLM_PROVIDER = previousProvider;
      if (previousEnabled === undefined) delete process.env.LLM_REVIEW_ENABLED;
      else process.env.LLM_REVIEW_ENABLED = previousEnabled;
    }
  });

  it("updates and persists a generated action item", async () => {
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
            id: "todo_1",
            sourceText: "请整理会议记录",
            translatedText: "Please organize the meeting notes",
          },
        ],
      },
    });
    await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/review`,
    });

    const updated = await app.inject({
      method: "PATCH",
      url: `/sessions/${sessionId}/action-items/0`,
      payload: { completed: true },
    });
    const detail = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    await app.close();

    expect(updated.statusCode).toBe(200);
    expect(updated.json().review.actionItems[0]).toMatchObject({
      text: expect.stringContaining("请整理会议记录"),
      completed: true,
    });
    expect(detail.json().review.actionItems[0].completed).toBe(true);
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
