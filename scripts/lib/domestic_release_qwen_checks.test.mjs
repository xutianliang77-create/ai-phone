import { describe, expect, test } from "vitest";
import { appendQwenLiveSmoke } from "./domestic_release_qwen_checks.mjs";

describe("appendQwenLiveSmoke", () => {
  test("blocks release when QWEN_API_KEY is missing", async () => {
    const context = baseContext({ apiKey: "" });

    await appendQwenLiveSmoke(context);

    expect(context.checks).toEqual([
      {
        name: "qwen_live_translation_smoke",
        status: "fail",
        details: { reason: "missing QWEN_API_KEY" },
      },
    ]);
    expect(context.issues).toContain(
      "QWEN_API_KEY is required for qwen_live smoke.",
    );
  });

  test("blocks placeholder QWEN_API_KEY before making a network request", async () => {
    const context = baseContext({
      apiKey: "replace-with-qwen-api-key",
      fetchFn: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await appendQwenLiveSmoke(context);

    expect(context.checks).toEqual([
      {
        name: "qwen_live_translation_smoke",
        status: "fail",
        details: { reason: "placeholder QWEN_API_KEY" },
      },
    ]);
    expect(context.issues).toContain(
      "QWEN_API_KEY must be a real production key for qwen_live smoke.",
    );
  });

  test("records a passing Chinese translation smoke", async () => {
    const requests = [];
    const context = baseContext({
      fetchFn: async (url, init) => {
        requests.push({
          url: String(url),
          body: JSON.parse(init.body),
          headers: init.headers,
        });
        return jsonResponse(200, {
          choices: [{ message: { content: "你好，测试通过。" } }],
        });
      },
    });

    await appendQwenLiveSmoke(context);

    expect(context.checks[0]).toMatchObject({
      name: "qwen_live_translation_smoke",
      status: "pass",
      details: { translation: "你好，测试通过。" },
    });
    expect(requests[0].url).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    expect(requests[0].body.enable_thinking).toBe(false);
    expect(requests[0].body.reasoning_effort).toBeUndefined();
    expect(requests[0].headers.authorization).toBe("Bearer qwen-key");
  });

  test("records Hy-MT2 as the server translation smoke provider", async () => {
    const requests = [];
    const context = baseContext({
      provider: "hymt2_self_hosted",
      baseUrl: "https://translation.qkxy.cn/v1",
      model: "tencent/Hy-MT2-1.8B",
      apiKey: "translation-key",
      fetchFn: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return jsonResponse(200, {
          choices: [{ message: { content: "你好，测试通过。" } }],
        });
      },
    });

    await appendQwenLiveSmoke(context);

    expect(context.checks[0]).toMatchObject({
      name: "server_translation_smoke",
      status: "pass",
    });
    expect(requests[0].model).toBe("tencent/Hy-MT2-1.8B");
    expect(requests[0].enable_thinking).toBeUndefined();
  });

  test("fails when the provider response is not Chinese", async () => {
    const context = baseContext({
      fetchFn: async () =>
        jsonResponse(200, { choices: [{ message: { content: "hello" } }] }),
    });

    await appendQwenLiveSmoke(context);

    expect(context.checks[0]).toMatchObject({
      name: "qwen_live_translation_smoke",
      status: "fail",
      details: { translation: "hello" },
    });
    expect(context.issues).toContain(
      "qwen_live smoke did not return a Chinese translation.",
    );
  });
});

function baseContext(overrides = {}) {
  return {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    apiKey: "qwen-key",
    maxTokens: 128,
    timeoutMs: 1000,
    checks: [],
    issues: [],
    actions: [],
    record: (checks, name, ok, details = {}) => {
      checks.push({ name, status: ok ? "pass" : "fail", details });
    },
    ...overrides,
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
