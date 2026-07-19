export type LlmProviderName = "off" | "mock" | "openai_compatible";

export interface LlmHealth {
  provider: LlmProviderName;
  status: "ready" | "disabled" | "configuration_required" | "unavailable";
  issues: string[];
  model?: string;
}

export interface LlmProviderUsage {
  provider: string;
  model?: string;
  promptVersion: string;
  latencyMs: number;
  inputCharacters: number;
  outputCharacters: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
}

export interface AsrRefinementInput {
  sessionId: string;
  segmentId: string;
  sourceLanguage: string;
  targetLanguage: string;
  rawText: string;
  previousSegments?: Array<{
    rawText?: string;
    optimizedText?: string;
    translatedText?: string;
  }>;
  protectedTerms?: string[];
  glossary?: Array<{ source: string; target?: string }>;
}

export interface AsrRefinementResult {
  optimizedText: string;
  confidence: number;
  operations: string[];
  protectedTermsKept: string[];
  warnings: string[];
  usage: LlmProviderUsage;
  fallbackReason?:
    | "timeout"
    | "low_confidence"
    | "invalid_json"
    | "provider_error"
    | "language_mismatch"
    | "content_expansion"
    | "disabled";
}

export interface SessionReviewInput {
  sessionId: string;
  titleHint?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  segments: Array<{
    id: string;
    speaker?: string;
    startedAtMs?: number;
    endedAtMs?: number;
    rawText?: string;
    optimizedText?: string;
    sourceText?: string;
    translatedText?: string;
  }>;
}

export interface SessionReviewResult {
  provider: "local" | "openai_compatible";
  model?: string;
  promptVersion?: string;
  generatedAt: string;
  title?: string;
  summary: string;
  decisions: string[];
  actionItems: Array<{
    text: string;
    owner?: string;
    dueDate?: string;
    priority?: "low" | "medium" | "high";
    evidenceSegmentIds: string[];
  }>;
  keyFacts: Array<{
    type: "time" | "money" | "location" | "number" | "custom";
    text: string;
    evidenceSegmentIds: string[];
  }>;
  risks: string[];
  openQuestions: string[];
  highlights: Array<{
    type: "time" | "money" | "todo" | "location" | "number" | "custom";
    text: string;
  }>;
  terms: Array<{
    sourceText: string;
    translatedText: string;
  }>;
  evidenceSegmentIds: string[];
}

export interface LlmProvider {
  name: LlmProviderName;
  healthCheck(): Promise<LlmHealth>;
  refineAsr(input: AsrRefinementInput): Promise<AsrRefinementResult>;
  generateReview(input: SessionReviewInput): Promise<SessionReviewResult>;
}
