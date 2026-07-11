import { describe, expect, test } from "vitest";
import {
  checkLmStudioTranslation,
  cleanTranslation,
  normalizeBaseUrl,
} from "./lmstudio_translation_smoke.mjs";

describe("checkLmStudioTranslation", () => {
  test("checks models and returns a cleaned translation", async () => {
    const requests = [];
    const result = await checkLmStudioTranslation({
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "qwen/qwen3.5-9b",
      timeoutMs: 1000,
      maxTokens: 128,
      text: "hello",
      fetchFn: fakeFetch(requests, {
        models: { data: [{ id: "qwen/qwen3.5-9b" }] },
        chat: {
          choices: [{ message: { content: "<think>hidden</think>你好" } }],
          usage: { completion_tokens_details: { reasoning_tokens: 0 } },
        },
      }),
    });

    expect(result).toMatchObject({
      status: "ready",
      modelListed: true,
      translation: "你好",
      reasoningTokens: 0,
    });
    expect(requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:1234/v1/models",
      "http://127.0.0.1:1234/v1/chat/completions",
    ]);
    expect(requests[1].body.reasoning_effort).toBe("none");
  });

  test("returns a fail result with actions when chat completion fails", async () => {
    const result = await checkLmStudioTranslation({
      baseUrl: "http://127.0.0.1:1234",
      model: "missing",
      timeoutMs: 1000,
      maxTokens: 128,
      text: "hello",
      fetchFn: fakeFetch([], {
        models: { data: [{ id: "other-model" }] },
        chatStatus: 400,
        chat: { error: { message: "Failed to load model" } },
      }),
    });

    expect(result.status).toBe("fail");
    expect(result.modelListed).toBe(false);
    expect(result.issues.join(" ")).toContain("Failed to load model");
    expect(result.actions.join(" ")).toContain("load the configured translation model");
  });

  test("omits reasoning effort for Hy-MT2-compatible providers", async () => {
    const requests = [];
    await checkLmStudioTranslation({
      baseUrl: "http://127.0.0.1:8003/v1",
      model: "tencent/Hy-MT2-1.8B",
      timeoutMs: 1000,
      maxTokens: 128,
      text: "hello",
      reasoningEffort: null,
      fetchFn: fakeFetch(requests, {
        models: { data: [{ id: "tencent/Hy-MT2-1.8B" }] },
        chat: { choices: [{ message: { content: "你好" } }] },
      }),
    });

    expect(requests[1].body.reasoning_effort).toBeUndefined();
  });
});

describe("translation cleanup", () => {
  test("normalizes base URL and extracts fallback reasoning translation", () => {
    expect(normalizeBaseUrl("http://host:1234/v1/")).toBe("http://host:1234");
    expect(cleanTranslation("", "Final Output:\n* 你好。这是测试。")).toBe(
      "你好。这是测试。",
    );
  });
});

function fakeFetch(requests, payloads) {
  return async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, body });
    const isChat = String(url).endsWith("/chat/completions");
    const status = isChat ? payloads.chatStatus ?? 200 : payloads.modelsStatus ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(isChat ? payloads.chat : payloads.models),
    };
  };
}
