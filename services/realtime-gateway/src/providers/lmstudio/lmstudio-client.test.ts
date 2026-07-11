import { describe, expect, it } from "vitest";
import { LmStudioClient } from "./lmstudio-client.js";

describe("lmstudio client", () => {
  it("translates via openai-compatible chat completions", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const client = new LmStudioClient({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "qwen/qwen3.5-9b",
      timeoutMs: 1000,
      fetchFn: (async (url: string, init?: RequestInit) => {
        requests.push({
          url,
          body: JSON.parse(init?.body as string) as Record<string, unknown>,
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{
              message: {
                content: "<think>hidden</think>你好",
              },
            }],
          }),
        };
      }) as typeof fetch,
    });

    const translated = await client.translate({
      text: "hello",
      sourceLanguage: "en",
      targetLanguage: "zh",
    });

    expect(requests[0]?.url).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect(requests[0]?.body.reasoning_effort).toBe("none");
    expect(translated).toBe("你好");
  });

  it("uses reasoning content as a last-resort fallback", async () => {
    const client = new LmStudioClient({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "qwen/qwen3.5-9b",
      timeoutMs: 1000,
      fetchFn: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: "",
              reasoning_content: "Final Output Generation:\n*   你好。这是一个实时翻译测试。\n",
            },
          }],
        }),
      })) as typeof fetch,
    });

    const translated = await client.translate({
      text: "hello",
      sourceLanguage: "en",
      targetLanguage: "zh",
    });

    expect(translated).toBe("你好。这是一个实时翻译测试。");
  });

  it("can use provider-specific body overrides", async () => {
    let requestBody: Record<string, unknown> = {};
    const client = new LmStudioClient({
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-plus",
      timeoutMs: 1000,
      reasoningEffort: null,
      extraBody: { enable_thinking: false },
      fetchFn: (async (_url: string, init?: RequestInit) => {
        requestBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "你好" } }],
          }),
        };
      }) as typeof fetch,
    });

    await client.translate({
      text: "hello",
      sourceLanguage: "en",
      targetLanguage: "zh",
    });

    expect(requestBody.reasoning_effort).toBeUndefined();
    expect(requestBody.enable_thinking).toBe(false);
  });

  it("includes lmstudio error details when chat completions fail", async () => {
    const client = new LmStudioClient({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "missing-model",
      timeoutMs: 1000,
      fetchFn: (async () => ({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({
          error: {
            message: "Failed to load model \"missing-model\"",
          },
        }),
      })) as typeof fetch,
    });

    await expect(client.translate({
      text: "hello",
      sourceLanguage: "en",
      targetLanguage: "zh",
    })).rejects.toThrow("Failed to load model");
  });

  it("adds active glossary terms to the translation prompt", async () => {
    let systemPrompt = "";
    const client = new LmStudioClient({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "qwen",
      timeoutMs: 1000,
      fetchFn: (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string) as {
          messages: Array<{ role: string; content: string }>;
        };
        systemPrompt = body.messages[0]?.content ?? "";
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "subtitles" } }],
          }),
        };
      }) as typeof fetch,
    });

    await client.translate({
      text: "字幕",
      sourceLanguage: "zh",
      targetLanguage: "en",
      terminology: [{
        id: "term_1",
        sourceText: "字幕",
        translatedText: "subtitles",
        sourceLanguage: "zh",
        targetLanguage: "en",
        status: "active",
        createdAt: "2026-07-03T00:00:00.000Z",
        updatedAt: "2026-07-03T00:00:00.000Z",
      }],
    });

    expect(systemPrompt).toContain("Use these glossary translations");
    expect(systemPrompt).toContain("字幕 => subtitles");
  });

  it("rejects content that is empty after reasoning cleanup", async () => {
    const client = new LmStudioClient({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "reasoning-model",
      timeoutMs: 1000,
      fetchFn: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: "<think>only reasoning</think>",
            },
          }],
        }),
      })) as typeof fetch,
    });

    await expect(client.translate({
      text: "hello",
      sourceLanguage: "en",
      targetLanguage: "zh",
    })).rejects.toThrow("empty translation");
  });
});
