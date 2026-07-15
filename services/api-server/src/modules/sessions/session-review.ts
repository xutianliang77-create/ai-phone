import {
  createLlmProvider,
  loadLlmConfig,
  type SessionReviewResult,
} from "@translation/llm";
import type {
  SessionReviewHighlightDto,
  SessionReviewResponse,
  SessionReviewTermDto,
} from "@translation/contracts";
import type { SessionRecord } from "./session-record.js";
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

function remoteReviewSegments(session: SessionRecord) {
  return sampleSegmentsForRemoteReview(session.segments)
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

function toSessionReviewResponse(
  review: SessionReviewResult,
  now = new Date(),
): SessionReviewResponse {
  return {
    provider: review.provider,
    ...(review.model ? { model: review.model } : {}),
    ...(review.promptVersion ? { promptVersion: review.promptVersion } : {}),
    generatedAt: now.toISOString(),
    ...(review.title ? { title: review.title } : {}),
    summary: review.summary,
    decisions: review.decisions,
    actionItems: review.actionItems,
    keyFacts: review.keyFacts,
    risks: review.risks,
    openQuestions: review.openQuestions,
    highlights: review.highlights,
    terms: review.terms,
    evidenceSegmentIds: review.evidenceSegmentIds,
  };
}

function textSegments(session: SessionRecord) {
  return session.segments
    .map((segment) => ({
      id: segment.id,
      sourceText: (
        segment.optimizedText ??
        segment.sourceText ??
        segment.rawText ??
        ""
      ).trim(),
      rawText: (segment.rawText ?? "").trim(),
      translatedText: segment.translatedText.trim(),
      speaker: segment.speaker?.displayName ?? segment.speaker?.speakerId,
    }))
    .filter((segment) => segment.sourceText || segment.translatedText);
}

function title(segments: ReturnType<typeof textSegments>) {
  const first = segments.find((segment) => segment.sourceText || segment.translatedText);
  return (first?.sourceText || first?.translatedText || "会话纪要").slice(0, 40);
}

function summary(segments: ReturnType<typeof textSegments>) {
  return segments
    .slice(0, 3)
    .map((segment) => {
      const text = segment.translatedText || segment.sourceText;
      return segment.speaker ? `${segment.speaker}：${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

function highlights(segments: ReturnType<typeof textSegments>) {
  const result: SessionReviewHighlightDto[] = [];
  for (const segment of segments) {
    const combined = [segment.sourceText, segment.translatedText].filter(Boolean).join("\n");
    const type = classifyHighlight(combined);
    if (!type) continue;
    result.push({ type, text: combined.slice(0, 300) });
    if (result.length >= 8) break;
  }
  return result;
}

function terms(segments: ReturnType<typeof textSegments>) {
  const seen = new Set<string>();
  const result: SessionReviewTermDto[] = [];
  for (const segment of segments) {
    if (!segment.sourceText || !segment.translatedText) continue;
    if (!looksLikeTerm(segment.sourceText)) continue;
    if (isSpelledIdentifierTerm(segment.sourceText, segment.translatedText)) continue;
    const key = segment.sourceText.toLowerCase();
    if (!seen.add(key)) continue;
    result.push({
      sourceText: segment.sourceText,
      translatedText: segment.translatedText,
    });
    if (result.length >= 12) break;
  }
  return result;
}

function isSpelledIdentifierTerm(sourceText: string, translatedText: string) {
  const source = sourceText.trim();
  const translated = translatedText.trim();
  if (source.toLowerCase() !== translated.toLowerCase()) return false;
  const tokens = source.split(/[\s,，、-]+/u).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 6) return false;
  return tokens.every((token) => /^[A-Za-z0-9]{1,6}$/u.test(token)) &&
    tokens.filter((token) => /^[A-Za-z]$/u.test(token)).length >= Math.min(2, tokens.length);
}

function actionItems(segments: ReturnType<typeof textSegments>) {
  return highlights(segments)
    .filter((item) => item.type === "todo")
    .map((item) => ({
      text: item.text,
      evidenceSegmentIds: segments
        .filter((segment) => item.text.includes(segment.sourceText))
        .map((segment) => segment.id)
        .slice(0, 3),
    }));
}

function keyFacts(segments: ReturnType<typeof textSegments>) {
  return highlights(segments)
    .filter((item) => item.type !== "todo" && item.type !== "custom")
    .map((item) => ({
      type: item.type === "todo" ? "custom" : item.type,
      text: item.text,
      evidenceSegmentIds: segments
        .filter((segment) => item.text.includes(segment.sourceText))
        .map((segment) => segment.id)
        .slice(0, 3),
    }));
}

function classifyHighlight(text: string): SessionReviewHighlightDto["type"] | null {
  if (/(\d{1,2}[:：]\d{2}|上午|下午|今天|明天|o'clock|tomorrow)/i.test(text)) return "time";
  if (/([$¥￥]\s?\d+|\d+\s?(元|美元|yuan|dollars?))/i.test(text)) return "money";
  if (/(需要|请|安排|确认|发送|整理|need|please|confirm|send|arrange)/i.test(text)) return "todo";
  if (/(地址|地点|会议室|room|address|location)/i.test(text)) return "location";
  if (/(\+?\d[\d -]{5,}\d)/.test(text)) return "number";
  return null;
}

function looksLikeTerm(source: string) {
  if (source.length < 2 || source.length > 24) return false;
  if (/[，。！？,.!?]/.test(source)) return false;
  return /[\u4e00-\u9fffA-Za-z]/.test(source);
}
