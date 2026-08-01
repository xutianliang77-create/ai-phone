import type { LlmConfig } from "./config.js";
import {
  applyAsrLocalRules,
  defaultAsrProtectedTerms,
} from "./local-rules.js";
import { OpenAiCompatibleLlmProvider } from "./openai-compatible-provider.js";
import type {
  AsrRefinementInput,
  AsrRefinementResult,
  LlmHealth,
  LlmProvider,
  SessionReviewInput,
  SessionReviewResult,
} from "./types.js";

export class OffLlmProvider implements LlmProvider {
  readonly name = "off" as const;

  async healthCheck(): Promise<LlmHealth> {
    return { provider: this.name, status: "disabled", issues: [] };
  }

  async refineAsr(input: AsrRefinementInput): Promise<AsrRefinementResult> {
    return localResult(input, "disabled");
  }

  async generateReview(): Promise<SessionReviewResult> {
    throw new Error("LLM review is disabled");
  }
}

export class MockLlmProvider implements LlmProvider {
  readonly name = "mock" as const;

  async healthCheck(): Promise<LlmHealth> {
    return { provider: this.name, status: "ready", issues: [] };
  }

  async refineAsr(input: AsrRefinementInput): Promise<AsrRefinementResult> {
    return localResult(input);
  }

  async generateReview(input: SessionReviewInput): Promise<SessionReviewResult> {
    const first = input.segments
      .map((segment) => segment.optimizedText || segment.rawText || segment.sourceText)
      .find(Boolean) ?? "";
    return {
      provider: "local",
      model: "mock",
      promptVersion: "session_review_v2",
      generatedAt: new Date().toISOString(),
      title: first.slice(0, 30) || "会话纪要",
      summary: first || "暂无可整理内容",
      decisions: [],
      actionItems: [],
      keyFacts: [],
      risks: [],
      openQuestions: [],
      highlights: [],
      terms: [],
      evidenceSegmentIds: input.segments.slice(0, 3).map((segment) => segment.id),
    };
  }
}

export function createLlmProvider(
  config: LlmConfig,
  fetchFn?: typeof fetch,
): LlmProvider {
  if (config.provider === "mock") return new MockLlmProvider();
  if (config.provider !== "openai_compatible") return new OffLlmProvider();
  const issues = providerIssues(config);
  if (issues.length > 0) return new OffLlmProvider();
  return new OpenAiCompatibleLlmProvider(config, fetchFn);
}

export async function refineAsrWithFallback(
  provider: LlmProvider,
  input: AsrRefinementInput,
  minConfidence = 0.72,
): Promise<AsrRefinementResult> {
  const local = localResult(input);
  if (provider.name === "off") return local;

  try {
    const result = await provider.refineAsr({
      ...input,
      rawText: local.optimizedText,
      protectedTerms: protectedTerms(input.protectedTerms),
    });
    if (result.confidence < minConfidence) {
      return { ...local, fallbackReason: "low_confidence" };
    }
    const postProcessed = applyAsrLocalRules(
      result.optimizedText,
      protectedTerms(input.protectedTerms),
    );
    if (changesDominantLanguage(local.optimizedText, postProcessed.text, input.sourceLanguage)) {
      return {
        ...local,
        fallbackReason: "language_mismatch",
        warnings: unique([
          ...local.warnings,
          "llm_refinement_changed_language",
        ]),
      };
    }
    if (changesProtectedSurface(local.optimizedText, postProcessed.text, input)) {
      return {
        ...local,
        fallbackReason: "protected_surface_changed",
        warnings: unique([
          ...local.warnings,
          "llm_refinement_changed_protected_surface",
        ]),
      };
    }
    if (addsUnsupportedContent(local.optimizedText, postProcessed.text)) {
      return {
        ...local,
        fallbackReason: "content_expansion",
        warnings: unique([
          ...local.warnings,
          "llm_refinement_added_unsupported_content",
        ]),
      };
    }
    return {
      ...result,
      optimizedText: postProcessed.text,
      operations: unique([...local.operations, ...result.operations, ...postProcessed.operations]),
      protectedTermsKept: unique([
        ...local.protectedTermsKept,
        ...result.protectedTermsKept,
        ...postProcessed.protectedTermsKept,
      ]),
      warnings: unique([...local.warnings, ...result.warnings, ...postProcessed.warnings]),
    };
  } catch (error) {
    return {
      ...local,
      fallbackReason: error instanceof SyntaxError ? "invalid_json" : "provider_error",
      warnings: unique([
        ...local.warnings,
        error instanceof Error ? error.message : "llm_refinement_failed",
      ]).slice(0, 8),
    };
  }
}

function addsUnsupportedContent(rawText: string, optimizedText: string) {
  const raw = comparableCharacters(rawText);
  const optimized = comparableCharacters(optimizedText);
  if (optimized.length <= raw.length && optimized === raw) return false;
  const supported = longestCommonSubsequenceLength(raw, optimized);
  const added = optimized.length - supported;
  return added > Math.max(3, Math.ceil(raw.length * 0.15));
}

function comparableCharacters(value: string) {
  return Array.from(value.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, ""));
}

function changesProtectedSurface(
  rawText: string,
  optimizedText: string,
  input: AsrRefinementInput,
) {
  const raw = protectedSurfaces(rawText);
  const optimized = protectedSurfaces(optimizedText);
  if (raw.join("\n") === optimized.join("\n")) return false;
  if (optimized.length < raw.length) return true;

  const evidence = [
    ...(input.previousSegments ?? []).flatMap((segment) => [
      segment.rawText,
      segment.optimizedText,
    ]),
    ...(input.protectedTerms ?? []),
    ...(input.glossary ?? []).flatMap((term) => [term.source, term.target]),
  ].filter((value): value is string => Boolean(value))
    .map((value) => value.normalize("NFKC").toLowerCase());
  return !optimized.every((surface) =>
    evidence.some((value) => value.includes(surface))
  );
}

function protectedSurfaces(value: string) {
  const normalized = value.normalize("NFKC");
  const surfaces = new Set<string>();
  const chineseNumber = "[零〇一二两三四五六七八九十百千万亿点\\d]";
  const patterns = [
    new RegExp(
      `${chineseNumber}+(?:到|至|[-~—])${chineseNumber}+` +
        "(?:位数?|元|块|岁|年|月|日|号|人|个|倍|之间)?",
      "g",
    ),
    new RegExp(
      `${chineseNumber}+(?:万元|亿元|元|块|岁|年|月|日|号|人|个|倍)`,
      "g",
    ),
    /\d+(?:[.,]\d+)?%?/g,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      surfaces.add(match[0].toLowerCase());
    }
  }
  for (const match of normalized.matchAll(/\b[A-Za-z][A-Za-z0-9._+-]*\b/g)) {
    const token = match[0];
    const upper = [...token].filter((character) =>
      character >= "A" && character <= "Z"
    ).length;
    if (
      /\d/.test(token) ||
      upper >= 2 ||
      ["api", "app", "atm", "gdp", "url"].includes(token.toLowerCase())
    ) {
      surfaces.add(token.toLowerCase());
    }
  }
  return [...surfaces].sort();
}

function longestCommonSubsequenceLength(first: string[], second: string[]) {
  const row = new Uint16Array(second.length + 1);
  for (const left of first) {
    let diagonal = 0;
    for (let index = 1; index <= second.length; index += 1) {
      const previous = row[index];
      row[index] = left === second[index - 1]
        ? diagonal + 1
        : Math.max(row[index], row[index - 1]);
      diagonal = previous;
    }
  }
  return row[second.length];
}

function localResult(
  input: AsrRefinementInput,
  fallbackReason?: AsrRefinementResult["fallbackReason"],
): AsrRefinementResult {
  const local = applyAsrLocalRules(
    input.rawText,
    protectedTerms(input.protectedTerms),
  );
  return {
    optimizedText: local.text,
    confidence: local.operations.length > 0 ? 0.86 : 0.7,
    operations: local.operations,
    protectedTermsKept: local.protectedTermsKept,
    warnings: local.warnings,
    fallbackReason,
    usage: {
      provider: local.operations.length > 0 ? "local_rules" : "off",
      promptVersion: "asr_refine_v2",
      latencyMs: 0,
      inputCharacters: input.rawText.length,
      outputCharacters: local.text.length,
      estimatedInputTokens: Math.max(1, Math.ceil(input.rawText.length / 4)),
      estimatedOutputTokens: Math.max(1, Math.ceil(local.text.length / 4)),
      estimatedTotalTokens: Math.max(2, Math.ceil((input.rawText.length + local.text.length) / 4)),
    },
  };
}

function protectedTerms(terms: string[] | undefined) {
  return unique([...(terms ?? []), ...defaultAsrProtectedTerms()]);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function changesDominantLanguage(
  rawText: string,
  optimizedText: string,
  sourceLanguage: string,
) {
  const normalizedLanguage = sourceLanguage.trim().toLowerCase();
  if (normalizedLanguage.startsWith("en")) {
    return looksEnglish(rawText) && looksChinese(optimizedText);
  }
  if (normalizedLanguage === "zh" || normalizedLanguage.startsWith("zh")) {
    return looksChinese(rawText) && looksEnglish(optimizedText);
  }
  return false;
}

function looksEnglish(value: string) {
  const latin = (value.match(/[A-Za-z]/g) ?? []).length;
  const chinese = (value.match(/[\u3400-\u9fff]/g) ?? []).length;
  return latin >= 3 && latin > chinese * 2;
}

function looksChinese(value: string) {
  const chinese = (value.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (value.match(/[A-Za-z]/g) ?? []).length;
  return chinese >= 2 && chinese >= latin;
}

function providerIssues(config: LlmConfig) {
  const issues: string[] = [];
  if (!config.baseUrl) issues.push("llm missing LLM_BASE_URL");
  if (!config.correctionModel && !config.reviewModel) {
    issues.push("llm missing LLM_CORRECTION_MODEL or LLM_REVIEW_MODEL");
  }
  return issues;
}
