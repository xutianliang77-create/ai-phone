import { describe, expect, it } from "vitest";
import { MockLlmProvider, refineAsrWithFallback } from "./providers.js";
import type {
  AsrRefinementInput,
  AsrRefinementResult,
  LlmHealth,
  LlmProvider,
  SessionReviewInput,
  SessionReviewResult,
} from "./types.js";

describe("LLM providers", () => {
  it("applies local ASR correction before provider fallback", async () => {
    const result = await refineAsrWithFallback(new MockLlmProvider(), {
      sessionId: "s1",
      segmentId: "seg1",
      sourceLanguage: "zh",
      targetLanguage: "en",
      rawText: "同船 Twin3ASR HiMT2 BoxCPM2 R120",
    });

    expect(result.optimizedText).toBe("同传 Qwen3 ASR Hy-MT2 VoxCPM2 A-120");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("normalizes common Qwen3 ASR homophones locally", async () => {
    const result = await refineAsrWithFallback(new MockLlmProvider(), {
      sessionId: "s1",
      segmentId: "seg1",
      sourceLanguage: "zh",
      targetLanguage: "en",
      rawText: "我们要测试 Quin3ASR、Hy-MT2 和 VoxCPM2",
    });

    expect(result.optimizedText).toBe("我们要测试 Qwen3 ASR、Hy-MT2 和 VoxCPM2");
    expect(result.operations).toContain("term_correction");
  });

  it("rejects LLM refinements that translate English ASR text", async () => {
    const result = await refineAsrWithFallback(new TranslatingLlmProvider(), {
      sessionId: "s1",
      segmentId: "seg1",
      sourceLanguage: "en",
      targetLanguage: "zh",
      rawText: "Hello. This is an online translation test.",
    });

    expect(result.optimizedText).toBe("Hello. This is an online translation test.");
    expect(result.fallbackReason).toBe("language_mismatch");
    expect(result.warnings).toContain("llm_refinement_changed_language");
  });
});

class TranslatingLlmProvider implements LlmProvider {
  readonly name = "openai_compatible" as const;

  async healthCheck(): Promise<LlmHealth> {
    return { provider: this.name, status: "ready", issues: [] };
  }

  async refineAsr(input: AsrRefinementInput): Promise<AsrRefinementResult> {
    return {
      optimizedText: "你好。这是一个在线翻译测试。",
      confidence: 0.99,
      operations: [],
      protectedTermsKept: [],
      warnings: [],
      usage: {
        provider: this.name,
        promptVersion: "asr_refine_v1",
        latencyMs: 1,
        inputCharacters: input.rawText.length,
        outputCharacters: 14,
        estimatedInputTokens: 10,
        estimatedOutputTokens: 10,
        estimatedTotalTokens: 20,
      },
    };
  }

  async generateReview(_input: SessionReviewInput): Promise<SessionReviewResult> {
    throw new Error("not implemented");
  }
}
