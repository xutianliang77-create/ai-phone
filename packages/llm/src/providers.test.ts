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

  it("rejects fluent content added beyond the current raw window", async () => {
    const result = await refineAsrWithFallback(new ExpandingLlmProvider(), {
      sessionId: "s1",
      segmentId: "qwen3_seg_800",
      sourceLanguage: "zh",
      targetLanguage: "en",
      rawText: "今天下午三点我们讨论产品计划，确认负责。",
    });

    expect(result.optimizedText).toBe(
      "今天下午三点我们讨论产品计划，确认负责。",
    );
    expect(result.fallbackReason).toBe("content_expansion");
    expect(result.warnings).toContain(
      "llm_refinement_added_unsupported_content",
    );
  });

  it("rejects numeric or entity changes without contextual evidence", async () => {
    const numeric = await refineAsrWithFallback(
      new ProtectedSurfaceChangingProvider("预算是十二万元，型号 A-120。"),
      {
        sessionId: "s1",
        segmentId: "seg1",
        sourceLanguage: "zh",
        targetLanguage: "en",
        rawText: "预算是二十万元，型号 A-120。",
      },
    );
    const entity = await refineAsrWithFallback(
      new ProtectedSurfaceChangingProvider("我们使用 Open API。"),
      {
        sessionId: "s1",
        segmentId: "seg2",
        sourceLanguage: "zh",
        targetLanguage: "en",
        rawText: "我们使用 OpenAI API。",
      },
    );

    expect(numeric.optimizedText).toBe("预算是二十万元，型号 A-120。");
    expect(numeric.fallbackReason).toBe("protected_surface_changed");
    expect(entity.optimizedText).toBe("我们使用 OpenAI API。");
    expect(entity.fallbackReason).toBe("protected_surface_changed");
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

class ExpandingLlmProvider extends TranslatingLlmProvider {
  override async refineAsr(input: AsrRefinementInput) {
    const base = await super.refineAsr(input);
    return {
      ...base,
      optimizedText:
        "今天下午三点我们讨论产品计划，确认负责人和截止日期，然后发送给所有参会人员。",
    };
  }
}

class ProtectedSurfaceChangingProvider extends TranslatingLlmProvider {
  constructor(private readonly text: string) {
    super();
  }

  override async refineAsr(input: AsrRefinementInput) {
    const base = await super.refineAsr(input);
    return { ...base, optimizedText: this.text };
  }
}
