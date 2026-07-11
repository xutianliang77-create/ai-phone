import { describe, expect, it } from "vitest";
import { OpenAiCompatibleLlmProvider } from "./openai-compatible-provider.js";
import type { LlmConfig } from "./config.js";

describe("OpenAI-compatible LLM provider", () => {
  it("disables thinking for realtime ASR refinement when reasoning effort is none", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const provider = new OpenAiCompatibleLlmProvider(config(), async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              optimizedText: "现在断句不稳定。",
              confidence: 0.95,
              operations: ["context_term_correction"],
              protectedTermsKept: ["断句"],
              warnings: [],
            }),
          },
        }],
      }), { status: 200 });
    });

    await provider.refineAsr({
      sessionId: "sess_1",
      segmentId: "seg_1",
      sourceLanguage: "zh",
      targetLanguage: "en",
      rawText: "现在端局不稳定。",
      protectedTerms: ["断句"],
      previousSegments: [{ rawText: "我们刚才在讨论 ASR 断句。" }],
    });

    expect(requestBody).toMatchObject({
      reasoning_effort: "none",
      enable_thinking: false,
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it("parses only final content and ignores reasoning content", async () => {
    const provider = new OpenAiCompatibleLlmProvider(config(), async () =>
      new Response(JSON.stringify({
        choices: [{
          message: {
            reasoning_content: JSON.stringify({
              optimizedText: "污染结果",
              confidence: 0.1,
              operations: [],
              protectedTermsKept: [],
              warnings: [],
            }),
            content: [
              "<think>这里不应进入软件</think>",
              "中间示例 {\"optimizedText\":\"示例\",\"confidence\":0.2}",
              JSON.stringify({
                optimizedText: "现在断句不稳定。",
                confidence: 0.95,
                operations: ["context_term_correction"],
                protectedTermsKept: ["断句"],
                warnings: [],
              }),
            ].join("\n"),
          },
        }],
      }), { status: 200 })
    );

    const result = await provider.refineAsr({
      sessionId: "sess_1",
      segmentId: "seg_1",
      sourceLanguage: "zh",
      targetLanguage: "en",
      rawText: "现在端局不稳定。",
      protectedTerms: ["断句"],
    });

    expect(result.optimizedText).toBe("现在断句不稳定。");
    expect(result.confidence).toBe(0.95);
  });

  it("rejects responses without final content instead of using reasoning text", async () => {
    const provider = new OpenAiCompatibleLlmProvider(config(), async () =>
      new Response(JSON.stringify({
        choices: [{
          message: {
            reasoning_content: JSON.stringify({
              optimizedText: "污染结果",
              confidence: 0.1,
              operations: [],
              protectedTermsKept: [],
              warnings: [],
            }),
            content: "",
          },
        }],
      }), { status: 200 })
    );

    await expect(provider.refineAsr({
      sessionId: "sess_1",
      segmentId: "seg_1",
      sourceLanguage: "zh",
      targetLanguage: "en",
      rawText: "现在端局不稳定。",
    })).rejects.toThrow("empty final content");
  });
});

function config(): LlmConfig {
  return {
    provider: "openai_compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    correctionModel: "qwen/qwen3.5-9b",
    reviewModel: "qwen/qwen3.5-9b",
    refinementEnabled: true,
    reviewEnabled: true,
    correctionTimeoutMs: 1000,
    reviewTimeoutMs: 1000,
    correctionMaxTokens: 128,
    reviewMaxTokens: 128,
    temperature: 0,
    reasoningEffort: "none",
    minConfidence: 0.72,
  };
}
