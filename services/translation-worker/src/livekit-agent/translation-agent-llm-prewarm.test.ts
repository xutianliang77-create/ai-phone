import { describe, expect, it, vi } from "vitest";
import type { LlmConfig } from "@translation/llm";
import { prewarmTranslationAgentLlm } from "./translation-agent-llm-prewarm.js";

describe("prewarmTranslationAgentLlm", () => {
  it("skips disabled refinement", async () => {
    await expect(prewarmTranslationAgentLlm({
      llmConfig: config({ refinementEnabled: false }),
    })).resolves.toEqual({
      status: "skipped",
      reason: "refinement_disabled",
    });
  });

  it("requires health and a real JSON refinement before readiness", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/models")) {
        return response(200, { data: [{ id: "qwen/qwen3.5-9b" }] });
      }
      return response(200, {
        choices: [{ message: { content: JSON.stringify({
          optimizedText: "准备就绪",
          confidence: 0.99,
          operations: [],
          protectedTermsKept: ["准备就绪"],
          warnings: [],
        }) } }],
      });
    });

    await expect(prewarmTranslationAgentLlm({ llmConfig: config() }, { fetchFn }))
      .resolves.toMatchObject({
        status: "ready",
        provider: "openai_compatible",
        model: "qwen/qwen3.5-9b",
        confidence: 0.99,
      });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the configured provider is unavailable", async () => {
    await expect(prewarmTranslationAgentLlm({ llmConfig: config() }, {
      fetchFn: async () => response(503, {}),
    })).rejects.toThrow("LLM is unavailable");
  });
});

function config(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider: "openai_compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    correctionModel: "qwen/qwen3.5-9b",
    reviewModel: "qwen/qwen3.5-9b",
    refinementEnabled: true,
    reviewEnabled: true,
    correctionTimeoutMs: 5000,
    reviewTimeoutMs: 30000,
    correctionMaxTokens: 128,
    reviewMaxTokens: 1024,
    temperature: 0,
    reasoningEffort: "none",
    minConfidence: 0.72,
    ...overrides,
  };
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
