import type { LlmProviderName } from "./types.js";

export interface LlmConfig {
  provider: LlmProviderName;
  baseUrl?: string;
  apiKey?: string;
  correctionModel?: string;
  reviewModel?: string;
  refinementEnabled: boolean;
  reviewEnabled: boolean;
  correctionTimeoutMs: number;
  reviewTimeoutMs: number;
  correctionMaxTokens: number;
  reviewMaxTokens: number;
  temperature: number;
  reasoningEffort?: string | null;
  minConfidence: number;
}

export function loadLlmConfig(
  env: Record<string, string | undefined> = process.env,
): LlmConfig {
  const provider = parseProvider(env.LLM_PROVIDER);
  const legacyReviewProvider = env.SESSION_REVIEW_PROVIDER === "openai_compatible";
  return {
    provider: provider ?? (legacyReviewProvider ? "openai_compatible" : "off"),
    baseUrl: env.LLM_BASE_URL ?? env.SUMMARY_BASE_URL,
    apiKey: env.LLM_API_KEY ?? env.SUMMARY_API_KEY,
    correctionModel: env.LLM_CORRECTION_MODEL ?? env.LLM_MODEL,
    reviewModel: env.LLM_REVIEW_MODEL ?? env.SUMMARY_MODEL ?? env.LLM_MODEL,
    refinementEnabled: parseBoolean(env.LLM_REFINEMENT_ENABLED, false),
    reviewEnabled: parseBoolean(env.LLM_REVIEW_ENABLED, legacyReviewProvider),
    correctionTimeoutMs: number(env.LLM_CORRECTION_TIMEOUT_MS, 2500),
    reviewTimeoutMs: number(env.LLM_REVIEW_TIMEOUT_MS, 30000),
    correctionMaxTokens: number(env.LLM_CORRECTION_MAX_TOKENS, 384),
    reviewMaxTokens: number(env.LLM_REVIEW_MAX_TOKENS ?? env.SUMMARY_MAX_TOKENS, 2048),
    temperature: number(env.LLM_TEMPERATURE, 0),
    reasoningEffort: env.LLM_REASONING_EFFORT ?? "none",
    minConfidence: number(env.LLM_MIN_CONFIDENCE, 0.72),
  };
}

export function llmConfigIssues(config: LlmConfig, task: "refine" | "review") {
  if (config.provider === "off" || config.provider === "mock") return [];
  const issues: string[] = [];
  if (!config.baseUrl) issues.push("llm missing LLM_BASE_URL");
  const model = task === "refine" ? config.correctionModel : config.reviewModel;
  if (!model) {
    issues.push(task === "refine"
      ? "llm missing LLM_CORRECTION_MODEL"
      : "llm missing LLM_REVIEW_MODEL");
  }
  return issues;
}

function parseProvider(value: string | undefined): LlmProviderName | undefined {
  if (value === "mock" || value === "openai_compatible" || value === "off") {
    return value;
  }
  return undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function number(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
