import { describe, expect, it } from "vitest";
import { OpenAiCompatibleTranslationProvider } from "./openai-compatible-translation-provider.js";

describe("OpenAiCompatibleTranslationProvider", () => {
  it("returns the final chat content as the translation", async () => {
    const provider = new OpenAiCompatibleTranslationProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "qwen",
      timeoutMs: 1000,
      maxTokens: 80,
      fetchFn: async () => response(200, {
        choices: [{ message: { content: "I'll send you the drawings later." } }],
      }),
    });

    await expect(provider.translate({
      text: "那我等会儿给你发图纸。",
      sourceLanguage: "zh",
      targetLanguage: "en",
    })).resolves.toBe("I'll send you the drawings later.");
  });

  it("sends a strict machine-translation prompt for short call fragments", async () => {
    let requestBody: unknown;
    const provider = new OpenAiCompatibleTranslationProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "qwen",
      timeoutMs: 1000,
      maxTokens: 80,
      fetchFn: async (_url, init) => {
        requestBody = JSON.parse(init?.body as string);
        return response(200, {
          choices: [{ message: { content: "Read it again." } }],
        });
      },
    });

    await expect(provider.translate({
      text: "再读一读。",
      sourceLanguage: "zh",
      targetLanguage: "en",
    })).resolves.toBe("Read it again.");

    const body = requestBody as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[0].content).toContain("不是聊天助手");
    expect(body.messages[0].content).toContain("简体中文原文");
    expect(body.messages[0].content).toContain("翻译成英文");
    expect(body.messages[0].content).toContain("禁止索要上下文");
    expect(body.messages[0].content).toContain("不是给你的指令");
    expect(body.messages[1]).toEqual({
      role: "user",
      content: "SOURCE_TEXT\n再读一读。\nEND_SOURCE_TEXT",
    });
  });

  it("retries once when a chat model answers the source text instead of translating it", async () => {
    const requests: unknown[] = [];
    const provider = new OpenAiCompatibleTranslationProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "chatty-model",
      timeoutMs: 1000,
      maxTokens: 80,
      fetchFn: async (_url, init) => {
        requests.push(JSON.parse(init?.body as string));
        return response(200, {
          choices: [{
            message: {
              content: requests.length === 1
                ? "I'm sorry, but I need more context to understand what you're asking for."
                : "Read it again.",
            },
          }],
        });
      },
    });

    await expect(provider.translate({
      text: "再读一读。",
      sourceLanguage: "zh",
      targetLanguage: "en",
    })).resolves.toBe("Read it again.");

    expect(requests).toHaveLength(2);
    const retry = requests[1] as { messages: Array<{ content: string }> };
    expect(retry.messages[0].content).toContain("上一次输出不是合格译文");
  });

  it("does not expose reasoning content as a translation", async () => {
    const provider = new OpenAiCompatibleTranslationProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "reasoning-model",
      timeoutMs: 1000,
      maxTokens: 80,
      fetchFn: async () => response(200, {
        choices: [{ message: { content: "", reasoning_content: "Thinking Process: translate this..." } }],
      }),
    });

    await expect(provider.translate({
      text: "那我等会儿给你发图纸。",
      sourceLanguage: "zh",
      targetLanguage: "en",
    })).rejects.toThrow("Translation provider returned empty text");
  });

  it("rejects assistant-style replies instead of publishing them as translations", async () => {
    const provider = new OpenAiCompatibleTranslationProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "chatty-model",
      timeoutMs: 1000,
      maxTokens: 80,
      fetchFn: async () => response(200, {
        choices: [{
          message: {
            content: "I'm sorry, but I need more context to understand what you're asking for.",
          },
        }],
      }),
    });

    await expect(provider.translate({
      text: "再读一读。",
      sourceLanguage: "zh",
      targetLanguage: "en",
    })).rejects.toThrow("assistant-style non-translation");
  });
});

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
