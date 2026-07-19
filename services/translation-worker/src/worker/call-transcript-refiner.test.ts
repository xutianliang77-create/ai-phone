import { describe, expect, it } from "vitest";
import type {
  AsrRefinementResult,
  LlmHealth,
  LlmProvider,
  SessionReviewResult,
} from "@translation/llm";
import { CallTranscriptRefiner } from "./call-transcript-refiner.js";

describe("CallTranscriptRefiner", () => {
  it("rejects LLM text that expands beyond the merged raw turn", async () => {
    const refiner = new CallTranscriptRefiner({
      provider: new ExpandingProvider(),
      enabled: true,
      minConfidence: 0.72,
      terminology: [],
    });

    const result = await refiner.refine("call_1", "host", {
      segmentId: "seg_1",
      text: "确认负责人。",
      language: "zh",
      confidence: 0.3,
    }, "en");

    expect(result.text).toBe("确认负责人。");
    expect(result.refinement).toMatchObject({
      provider: "off",
      promptVersion: "asr_refine_v2",
      fallbackReason: "content_expansion",
    });
  });
});

class ExpandingProvider implements LlmProvider {
  readonly name = "openai_compatible" as const;

  async healthCheck(): Promise<LlmHealth> {
    return { provider: this.name, status: "ready", issues: [] };
  }

  async refineAsr(): Promise<AsrRefinementResult> {
    return {
      optimizedText: "确认负责人和截止日期，然后发送给所有参会人员。",
      confidence: 0.99,
      operations: ["context_rewrite"],
      protectedTermsKept: [],
      warnings: [],
      usage: {
        provider: this.name,
        model: "test",
        promptVersion: "test",
        latencyMs: 1,
        inputCharacters: 6,
        outputCharacters: 22,
        estimatedInputTokens: 3,
        estimatedOutputTokens: 11,
        estimatedTotalTokens: 14,
      },
    };
  }

  async generateReview(): Promise<SessionReviewResult> {
    throw new Error("unused");
  }
}
