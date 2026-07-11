import { describe, expect, it } from "vitest";
import type {
  AsrRefinementInput,
  AsrRefinementResult,
  LlmHealth,
  LlmProvider,
  SessionReviewInput,
  SessionReviewResult,
} from "@translation/llm";
import { refineRealtimeTranscript } from "./lmstudio-asr-refinement.js";

describe("lmstudio ASR refinement", () => {
  it("uses contextual LLM refinement for suspicious ASR text", async () => {
    const provider = new SpyLlmProvider();
    const result = await refineRealtimeTranscript({
      provider,
      enabled: true,
      minConfidence: 0.72,
      session: session(),
      transcript: {
        segmentId: "seg_1",
        text: "现在端局不稳定，我们要测试系统。",
        language: "zh",
        confidence: 0.9,
      },
      targetLanguage: "en",
      previousSegments: [{
        rawText: "我们刚才在讨论 ASR 断句。",
        translatedText: "We were discussing ASR segmentation.",
      }],
    });

    expect(provider.calls).toBe(1);
    expect(result.rawText).toBe("现在端局不稳定，我们要测试系统。");
    expect(result.optimizedText).toBe("现在断句不稳定，我们要测试系统。");
    expect(result.text).toBe("现在断句不稳定，我们要测试系统。");
    expect(result.refinement.provider).toBe("openai_compatible");
  });

  it("skips contextual LLM refinement for clean high-confidence text", async () => {
    const provider = new SpyLlmProvider();
    const result = await refineRealtimeTranscript({
      provider,
      enabled: true,
      minConfidence: 0.72,
      session: session(),
      transcript: {
        segmentId: "seg_2",
        text: "今天下午三点开会。",
        language: "zh",
        confidence: 0.95,
      },
      targetLanguage: "en",
      previousSegments: [],
    });

    expect(provider.calls).toBe(0);
    expect(result.optimizedText).toBeUndefined();
    expect(result.text).toBe("今天下午三点开会。");
    expect(result.refinement.provider).toBe("off");
  });
});

class SpyLlmProvider implements LlmProvider {
  readonly name = "openai_compatible" as const;
  calls = 0;

  async healthCheck(): Promise<LlmHealth> {
    return { provider: this.name, status: "ready", issues: [] };
  }

  async refineAsr(input: AsrRefinementInput): Promise<AsrRefinementResult> {
    this.calls += 1;
    const optimizedText = input.rawText.replace(/端局/g, "断句");
    return {
      optimizedText,
      confidence: 0.96,
      operations: ["context_term_correction"],
      protectedTermsKept: [],
      warnings: [],
      usage: {
        provider: this.name,
        model: "qwen/qwen3.5-9b",
        promptVersion: "asr_refine_v2",
        latencyMs: 12,
        inputCharacters: input.rawText.length,
        outputCharacters: optimizedText.length,
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

function session() {
  return {
    sessionId: "sess_1",
    sourceLanguage: "zh" as const,
    targetLanguage: "en" as const,
    voiceOutput: false,
  };
}
