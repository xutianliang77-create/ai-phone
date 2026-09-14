import type { TranslationLanguageCode } from "../shared/languages.js";

export interface SessionReviewHighlightDto {
  type: "time" | "money" | "todo" | "location" | "number" | "custom";
  text: string;
}

export interface SessionReviewTermDto {
  sourceText: string;
  translatedText: string;
}

export interface SessionReviewActionItemDto {
  text: string;
  completed?: boolean;
  owner?: string;
  dueDate?: string;
  evidenceSegmentIds: string[];
}

export interface SessionReviewKeyFactDto {
  type: "time" | "money" | "location" | "number" | "custom";
  text: string;
  evidenceSegmentIds: string[];
}

/**
 * Device rules are generated from the history already stored on the phone.
 * Public semantic enhancement is intentionally an explicit user action.
 */
export type SessionReviewGenerationKind =
  | "device_rules"
  | "public_semantic_enhancement";

export interface GenerateSessionReviewRequest {
  generationKind: "public_semantic_enhancement";
}

export interface TermbaseTermDto {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLanguage: TranslationLanguageCode;
  targetLanguage: TranslationLanguageCode;
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
}

export interface SaveTermbaseTermRequest {
  sourceText: string;
  translatedText: string;
  sourceLanguage?: TranslationLanguageCode;
  targetLanguage?: TranslationLanguageCode;
  termbaseId?: string;
  sessionId?: string;
}

export interface TermbaseTermsResponse {
  terms: TermbaseTermDto[];
}

export interface TermbaseTermResponse {
  term: TermbaseTermDto;
}

export interface SessionReviewResponse {
  provider: "local" | "openai_compatible";
  model?: string;
  promptVersion?: string;
  generatedAt: string;
  title?: string;
  summary: string;
  decisions?: string[];
  actionItems?: SessionReviewActionItemDto[];
  keyFacts?: SessionReviewKeyFactDto[];
  risks?: string[];
  openQuestions?: string[];
  highlights: SessionReviewHighlightDto[];
  terms: SessionReviewTermDto[];
  evidenceSegmentIds?: string[];
  /** Indicates whether this persisted result is local rules or public semantics. */
  generationKind?: SessionReviewGenerationKind;
  /** SHA-256 of the ordered, source-bearing segment revisions used for this review. */
  sourceFingerprint?: string;
}
