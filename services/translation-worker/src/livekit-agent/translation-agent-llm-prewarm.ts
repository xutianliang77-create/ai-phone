import {
  createLlmProvider,
  llmConfigIssues,
} from "@translation/llm";
import type { TranslationWorkerEnv } from "../config/env.js";

type LlmPrewarmEnv = Pick<
  TranslationWorkerEnv,
  "llmConfig" | "llmPrewarmTimeoutMs"
>;

export type TranslationAgentLlmPrewarmResult =
  | { status: "skipped"; reason: "refinement_disabled" }
  | {
    status: "ready";
    elapsedMs: number;
    provider: string;
    model?: string;
    confidence: number;
  };

export async function prewarmTranslationAgentLlm(
  env: LlmPrewarmEnv,
  options: { fetchFn?: typeof fetch } = {},
): Promise<TranslationAgentLlmPrewarmResult> {
  if (!env.llmConfig.refinementEnabled) {
    return { status: "skipped", reason: "refinement_disabled" };
  }
  const issues = llmConfigIssues(env.llmConfig, "refine");
  if (issues.length > 0) {
    throw new Error(`Translation Agent LLM is not configured: ${issues.join("; ")}`);
  }
  const provider = createLlmProvider({
    ...env.llmConfig,
    correctionTimeoutMs: env.llmPrewarmTimeoutMs,
  }, options.fetchFn);
  const health = await provider.healthCheck();
  if (health.status !== "ready") {
    throw new Error(
      `Translation Agent LLM is ${health.status}: ${health.issues.join("; ")}`,
    );
  }
  const startedAt = Date.now();
  const result = await provider.refineAsr({
    sessionId: "agent-node-prewarm",
    segmentId: "agent-node-prewarm",
    sourceLanguage: "zh",
    targetLanguage: "en",
    rawText: "准备就绪",
    protectedTerms: ["准备就绪"],
  });
  if (!result.optimizedText.trim()) {
    throw new Error("Translation Agent LLM prewarm returned empty text");
  }
  return {
    status: "ready",
    elapsedMs: Date.now() - startedAt,
    provider: provider.name,
    model: result.usage.model ?? health.model,
    confidence: result.confidence,
  };
}
