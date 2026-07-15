import { afterEach, describe, expect, it } from "vitest";
import {
  generateSessionReview,
  localSessionReview,
  resetSessionReviewProviderRuntimeStatusForTest,
  sessionReviewProviderStatus,
} from "./session-review.js";
import type { SessionRecord } from "./session-record.js";

describe("session review", () => {
  const previousEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...previousEnv };
    resetSessionReviewProviderRuntimeStatusForTest();
  });

  it("builds local summaries, highlights, and terms", () => {
    const review = localSessionReview(session(), new Date("2026-07-03T00:00:00Z"));

    expect(review).toMatchObject({
      provider: "local",
      generatedAt: "2026-07-03T00:00:00.000Z",
      summary: expect.stringContaining("Meeting at three this afternoon"),
    });
    expect(review.highlights.map((item) => item.type)).toContain("time");
    expect(review.highlights.map((item) => item.type)).toContain("money");
    expect(review.terms).toContainEqual({
      sourceText: "字幕",
      translatedText: "subtitles",
    });
    expect(review.terms).not.toContainEqual({
      sourceText: "A E Q",
      translatedText: "A E Q",
    });
  });

  it("parses OpenAI-compatible JSON review output", async () => {
    process.env.SESSION_REVIEW_PROVIDER = "openai_compatible";
    process.env.SUMMARY_BASE_URL = "http://127.0.0.1:1234/v1";
    process.env.SUMMARY_MODEL = "qwen";
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

    const review = await generateSessionReview(session(), {
      now: new Date("2026-07-03T00:00:00Z"),
      fetchFn: async (url, init) => {
        if (String(url).endsWith("/models")) {
          return new Response(JSON.stringify({ data: [{ id: "qwen" }] }), {
            status: 200,
          });
        }
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  summary: "讨论了会议时间和预算。",
                  decisions: [{ content: "下午三点开会" }],
                  actionItems: [{ content: "会后发送纪要", evidenceSegmentIds: ["1"] }],
                  keyFacts: [{ type: "time", content: "下午三点", evidenceSegmentIds: ["1"] }],
                  risks: [{ content: "预算需确认" }],
                  openQuestions: [{ content: "参会人待确认" }],
                  highlights: [{ type: "todo", content: "会后发送纪要" }],
                  terms: [
                    { sourceText: "字幕", translatedText: "subtitles" },
                    { sourceText: "A E Q", translatedText: "A E Q" },
                  ],
                }),
              },
            }],
          }),
          { status: 200 },
        );
      },
    });

    expect(requests[0].url).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect(requests[0].body).toMatchObject({ model: "qwen" });
    expect(review).toMatchObject({
      provider: "openai_compatible",
      summary: "讨论了会议时间和预算。",
      decisions: ["下午三点开会"],
      actionItems: [{ text: "会后发送纪要", evidenceSegmentIds: ["1"] }],
      keyFacts: [{ type: "time", text: "下午三点", evidenceSegmentIds: ["1"] }],
      risks: ["预算需确认"],
      openQuestions: ["参会人待确认"],
      highlights: [{ type: "todo", text: "会后发送纪要" }],
    });
    expect(review.terms).toEqual([{
      sourceText: "字幕",
      translatedText: "subtitles",
    }]);
    expect(sessionReviewProviderStatus()).toMatchObject({
      status: "ready",
      issues: [],
      lastCheckedAt: "2026-07-03T00:00:00.000Z",
    });
  });

  it("compacts long sessions before sending review input to the provider", async () => {
    process.env.SESSION_REVIEW_PROVIDER = "openai_compatible";
    process.env.SUMMARY_BASE_URL = "http://127.0.0.1:1234/v1";
    process.env.SUMMARY_MODEL = "qwen";
    const requests: Array<{ body: { messages: Array<{ content: string }> } }> = [];

    await generateSessionReview(longSession(), {
      fetchFn: async (url, init) => {
        if (String(url).endsWith("/models")) {
          return new Response(JSON.stringify({ data: [{ id: "qwen" }] }), {
            status: 200,
          });
        }
        requests.push({ body: JSON.parse(String(init?.body)) });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ summary: "ok" }) } }],
          }),
          { status: 200 },
        );
      },
    });

    const payload = JSON.parse(requests[0].body.messages[1].content) as {
      segments: Array<{ id: string; sourceText: string; translatedText: string }>;
    };
    expect(payload.segments).toHaveLength(40);
    expect(payload.segments[0].id).toBe("1");
    expect(payload.segments.at(-1)?.id).toBe("120");
    expect(payload.segments.every((segment) => segment.sourceText.length <= 180)).toBe(true);
  });

  it("falls back to local review when OpenAI-compatible provider fails", async () => {
    process.env.SESSION_REVIEW_PROVIDER = "openai_compatible";
    process.env.SUMMARY_BASE_URL = "http://127.0.0.1:1234/v1";
    process.env.SUMMARY_MODEL = "qwen";

    const review = await generateSessionReview(session(), {
      now: new Date("2026-07-03T00:00:00Z"),
      fetchFn: async (url) => {
        if (String(url).endsWith("/models")) {
          return new Response(JSON.stringify({ data: [{ id: "qwen" }] }), {
            status: 200,
          });
        }
        throw new TypeError("fetch failed");
      },
    });

    expect(review).toMatchObject({
      provider: "local",
      summary: expect.stringContaining("Meeting at three this afternoon"),
      risks: [expect.stringContaining("LLM 纪要暂不可用")],
    });
    expect(sessionReviewProviderStatus()).toMatchObject({
      status: "degraded",
      issues: [expect.stringContaining("fetch failed")],
      lastCheckedAt: "2026-07-03T00:00:00.000Z",
    });
  });
});

function session(): SessionRecord {
  return {
    id: "s1",
    userId: "guest-user",
    mode: "meeting",
    status: "ended",
    consumedSeconds: 60,
    createdAt: "2026-07-03T00:00:00.000Z",
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
      {
        id: "3",
        sourceText: "字幕",
        translatedText: "subtitles",
      },
      {
        id: "4",
        sourceText: "A E Q",
        translatedText: "A E Q",
      },
    ],
  };
}

function longSession(): SessionRecord {
  return {
    ...session(),
    segments: Array.from({ length: 120 }, (_, index) => ({
      id: String(index + 1),
      sourceText: `第${index + 1}段` + "很长".repeat(160),
      translatedText: `segment ${index + 1} ` + "long ".repeat(160),
    })),
  };
}
