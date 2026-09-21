import { toSessionReviewResponse, textSegments, title, summary, highlights, terms, actionItems, keyFacts } from "./session-review-formatting.js";
import { createHash } from "node:crypto";
import {
  createLlmProvider,
  loadLlmConfig
} from "@translation/llm";
import type {
  SessionReviewResponse
} from "@translation/contracts";
import type { SessionRecord } from "./session-record.js";
import { orderSessionSegmentsChronologically } from "./session-segment-order.js";
import {
  recordRemoteReviewFailure,
  recordRemoteReviewSuccess,
} from "./session-review-provider-status.js";
export {
  resetSessionReviewProviderRuntimeStatusForTest,
  sessionReviewProviderStatus,
} from "./session-review-provider-status.js";

const maxRemoteReviewSegments = 40;
const maxReviewSourceCharacters = 180;
const maxReviewTranslationCharacters = 240;

export interface SessionReviewOptions {
  now?: Date;
  fetchFn?: typeof fetch;
}

export class PublicSemanticReviewUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicSemanticReviewUnavailableError";
  }
}

export async function generateSessionReview(
  session: SessionRecord,
  options: SessionReviewOptions = {},
): Promise<SessionReviewResponse> {
  const config = loadLlmConfig();
  if (config.reviewEnabled && config.provider !== "off") {
    const provider = createLlmProvider(config, options.fetchFn);
    const health = await provider.healthCheck();
    if (health.status !== "ready") {
      const reason =
        health.issues.join("; ") || "LLM review provider unavailable";
      recordRemoteReviewFailure(config, reason, options.now);
      return localSessionReviewFallback(session, options.now, reason);
    }
    try {
      const review = await provider.generateReview({
        sessionId: session.id,
        segments: remoteReviewSegments(session),
      });
      recordRemoteReviewSuccess(config, options.now);
      return toSessionReviewResponse(review, options.now);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      recordRemoteReviewFailure(config, reason, options.now);
      return localSessionReviewFallback(session, options.now, reason);
    }
  }
  return localSessionReview(session, options.now);
}

/**
 * Public semantic review is deliberately separate from the legacy/local
 * fallback path. An explicit request must never silently become a server-side
 * rules pass when public capability is unavailable.
 */
export async function generatePublicSemanticReview(
  session: SessionRecord,
  options: SessionReviewOptions = {},
): Promise<SessionReviewResponse> {
  const config = loadLlmConfig();
  if (!config.reviewEnabled || config.provider === "off") {
    throw new PublicSemanticReviewUnavailableError(
      "Public semantic review is not enabled",
    );
  }
  const provider = createLlmProvider(config, options.fetchFn);
  const health = await provider.healthCheck();
  if (health.status !== "ready") {
    const reason = health.issues.join("; ") || "LLM review provider unavailable";
    recordRemoteReviewFailure(config, reason, options.now);
    throw new PublicSemanticReviewUnavailableError(reason);
  }
  try {
    const review = await provider.generateReview({
      sessionId: session.id,
      segments: remoteReviewSegments(session),
    });
    recordRemoteReviewSuccess(config, options.now);
    return bindPublicSemanticReviewToSource(
      toSessionReviewResponse(review, options.now),
      session,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    recordRemoteReviewFailure(config, reason, options.now);
    if (error instanceof PublicSemanticReviewUnavailableError) throw error;
    throw new PublicSemanticReviewUnavailableError(reason);
  }
}

/** The fingerprint is server-derived; caller input never decides cache reuse. */
export function sessionReviewSourceFingerprint(session: SessionRecord) {
  const source = orderSessionSegmentsChronologically(session.segments).map((segment) => ({
    id: segment.id,
    turnId: segment.turnId,
    revision: segment.revision,
    rawText: segment.rawText,
    optimizedText: segment.optimizedText,
    sourceText: segment.sourceText,
    translatedText: segment.translatedText,
    sourceLanguage: segment.sourceLanguage,
    targetLanguage: segment.targetLanguage,
    speakerId: segment.speaker?.speakerId,
    startMs: segment.timing?.startMs,
    endMs: segment.timing?.endMs,
  }));
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

function remoteReviewSegments(session: SessionRecord) {
  return sampleSegmentsForRemoteReview(
    orderSessionSegmentsChronologically(session.segments),
  )
    .map((segment) => ({
      id: segment.id,
      rawText: compactReviewText(segment.rawText, maxReviewSourceCharacters),
      optimizedText: compactReviewText(segment.optimizedText, maxReviewSourceCharacters),
      sourceText: compactReviewText(segment.sourceText, maxReviewSourceCharacters),
      translatedText: compactReviewText(segment.translatedText, maxReviewTranslationCharacters),
      speaker: segment.speaker?.displayName ?? segment.speaker?.speakerId,
      startedAtMs: segment.timing?.startMs,
      endedAtMs: segment.timing?.endMs,
      endpointReason: segment.vadContext?.endpointReason,
    }));
}

function sampleSegmentsForRemoteReview(segments: SessionRecord["segments"]) {
  const meaningful = segments.filter(
    (segment) =>
      segment.rawText?.trim() ||
      segment.optimizedText?.trim() ||
      segment.sourceText?.trim() ||
      segment.translatedText?.trim(),
  );
  if (meaningful.length <= maxRemoteReviewSegments) return meaningful;

  const result: SessionRecord["segments"] = [];
  const seen = new Set<string>();
  const step = (meaningful.length - 1) / (maxRemoteReviewSegments - 1);
  for (let index = 0; index < maxRemoteReviewSegments; index += 1) {
    const segment = meaningful[Math.round(index * step)];
    if (!segment || seen.has(segment.id)) continue;
    seen.add(segment.id);
    result.push(segment);
  }
  return result;
}

function compactReviewText(value: string | undefined, maxLength: number) {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

export function localSessionReview(
  session: SessionRecord,
  now = new Date(),
): SessionReviewResponse {
  const segments = textSegments(session);
  return {
    provider: "local",
    promptVersion: "session_review_local_v2",
    generatedAt: now.toISOString(),
    title: title(segments),
    summary: summary(segments),
    decisions: [],
    actionItems: actionItems(segments),
    keyFacts: keyFacts(segments),
    risks: [],
    openQuestions: [],
    highlights: highlights(segments),
    terms: terms(segments),
    evidenceSegmentIds: segments.slice(0, 5).map((segment) => segment.id),
  };
}

function bindPublicSemanticReviewToSource(
  review: SessionReviewResponse,
  session: SessionRecord,
): SessionReviewResponse {
  const validIds = new Set(session.segments.map((segment) => segment.id));
  const evidence = validEvidenceIds(review.evidenceSegmentIds, validIds);
  const actionItems = (review.actionItems ?? [])
    .map((item) => ({
      ...item,
      evidenceSegmentIds: validEvidenceIds(item.evidenceSegmentIds, validIds),
    }))
    .filter((item) => item.evidenceSegmentIds.length > 0);
  const keyFacts = (review.keyFacts ?? [])
    .map((item) => ({
      ...item,
      evidenceSegmentIds: validEvidenceIds(item.evidenceSegmentIds, validIds),
    }))
    .filter((item) => item.evidenceSegmentIds.length > 0);
  const boundEvidence = uniqueIds([
    ...evidence,
    ...actionItems.flatMap((item) => item.evidenceSegmentIds),
    ...keyFacts.flatMap((item) => item.evidenceSegmentIds),
  ]);
  if (boundEvidence.length === 0) {
    throw new PublicSemanticReviewUnavailableError(
      "Public semantic review did not cite an existing source segment",
    );
  }
  return {
    ...review,
    actionItems,
    keyFacts,
    evidenceSegmentIds: boundEvidence,
    generationKind: "public_semantic_enhancement",
    sourceFingerprint: sessionReviewSourceFingerprint(session),
  };
}

function validEvidenceIds(value: string[] | undefined, validIds: Set<string>) {
  return uniqueIds((value ?? []).filter((id) => validIds.has(id)));
}

function uniqueIds(values: string[]) {
  return [...new Set(values)];
}

function localSessionReviewFallback(
  session: SessionRecord,
  now: Date | undefined,
  reason: string,
) {
  const review = localSessionReview(session, now);
  return {
    ...review,
    risks: [
      ...(review.risks ?? []),
      `LLM 纪要暂不可用，已使用本地纪要：${sanitizeFallbackReason(reason)}`,
    ],
  };
}

function sanitizeFallbackReason(reason: string) {
  return reason.replace(/\s+/g, " ").slice(0, 180);
}
