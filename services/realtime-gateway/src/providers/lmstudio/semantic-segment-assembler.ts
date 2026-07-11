import type { TranscriptResult } from "../../asr/asr-provider.js";

interface PendingSegment {
  parts: TranscriptResult[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SemanticSegmentAssemblerOptions {
  maxBufferedSegments?: number;
  maxBufferedCharacters?: number;
  maxBufferMs?: number;
}

export interface SemanticSegmentPushResult {
  ready: TranscriptResult[];
  partial?: TranscriptResult;
}

const DEFAULT_MAX_BUFFERED_SEGMENTS = 3;
const DEFAULT_MAX_BUFFERED_CHARACTERS = 180;
const DEFAULT_MAX_BUFFER_MS = 1800;

const chineseContinuationSuffixes = [
  "因为",
  "但是",
  "不过",
  "然后",
  "如果",
  "所以",
  "而且",
  "并且",
  "同时",
  "之后",
  "之前",
  "以后",
  "的时候",
  "的话",
  "就是",
  "比如",
  "例如",
  "关于",
  "对于",
  "为了",
  "按照",
  "通过",
  "需要",
  "可以让",
  "会把",
  "我觉得",
  "我认为",
  "我们要",
  "我们需要",
  "接下来",
  "下一步",
  "主要是",
  "重点是",
  "包括",
  "以及",
  "还有",
  "或者",
  "不仅",
  "不但",
  "虽然",
  "即使",
  "只要",
  "仅仅",
  "各大",
  "也都",
  "都",
  "只",
  "跟",
  "和",
  "把",
  "给",
  "从",
  "在",
  "到",
  "对",
  "被",
  "让",
  "使",
  "用",
  "以",
  "上",
  "中",
  "里",
  "内",
  "下",
];

const englishContinuationSuffixes = [
  "because",
  "but",
  "and",
  "or",
  "so",
  "then",
  "if",
  "when",
  "while",
  "although",
  "though",
  "that",
  "which",
  "who",
  "to",
  "of",
  "for",
  "with",
  "about",
  "after",
  "before",
  "during",
  "from",
  "into",
  "in",
  "on",
  "at",
  "under",
  "over",
  "between",
  "through",
  "by",
  "as",
  "is",
  "are",
  "was",
  "were",
  "will",
  "would",
  "can",
  "could",
  "should",
  "the",
  "a",
  "an",
  "this is",
  "there is",
  "there are",
  "need to",
  "going to",
  "in order to",
];

export class SemanticSegmentAssembler {
  private readonly maxBufferedSegments: number;
  private readonly maxBufferedCharacters: number;
  private readonly maxBufferMs: number;
  private readonly pending = new Map<string, PendingSegment>();

  constructor(options: SemanticSegmentAssemblerOptions = {}) {
    this.maxBufferedSegments =
      options.maxBufferedSegments ?? DEFAULT_MAX_BUFFERED_SEGMENTS;
    this.maxBufferedCharacters =
      options.maxBufferedCharacters ?? DEFAULT_MAX_BUFFERED_CHARACTERS;
    this.maxBufferMs = options.maxBufferMs ?? DEFAULT_MAX_BUFFER_MS;
  }

  push(
    sessionId: string,
    transcript: TranscriptResult,
    nowMs = Date.now(),
  ): SemanticSegmentPushResult {
    const existing = this.pending.get(sessionId);
    if (!existing) return this.acceptNew(sessionId, transcript, nowMs);

    if (shouldSplitPending(existing, transcript, nowMs, this.maxBufferMs)) {
      this.pending.delete(sessionId);
      const current = this.acceptNew(sessionId, transcript, nowMs);
      return {
        ready: [mergePending(existing), ...current.ready],
        ...(current.partial ? { partial: current.partial } : {}),
      };
    }

    existing.parts.push(transcript);
    existing.updatedAtMs = nowMs;
    const merged = mergePending(existing);
    if (this.shouldRelease(existing, merged, nowMs)) {
      this.pending.delete(sessionId);
      return { ready: [merged] };
    }

    this.pending.set(sessionId, existing);
    return { ready: [], partial: merged };
  }

  flush(sessionId: string): TranscriptResult[] {
    const existing = this.pending.get(sessionId);
    if (!existing) return [];
    this.pending.delete(sessionId);
    return [mergePending(existing)];
  }

  clear(sessionId: string) {
    this.pending.delete(sessionId);
  }

  private acceptNew(
    sessionId: string,
    transcript: TranscriptResult,
    nowMs: number,
  ): SemanticSegmentPushResult {
    if (!shouldHoldForNextSegment(transcript.text, transcript.language)) {
      return { ready: [transcript] };
    }
    const pending = { parts: [transcript], createdAtMs: nowMs, updatedAtMs: nowMs };
    this.pending.set(sessionId, pending);
    return { ready: [], partial: transcript };
  }

  private shouldRelease(
    pending: PendingSegment,
    transcript: TranscriptResult,
    nowMs: number,
  ) {
    return (
      !shouldHoldForNextSegment(transcript.text, transcript.language) ||
      pending.parts.length >= this.maxBufferedSegments ||
      textLength(transcript.text) >= this.maxBufferedCharacters ||
      nowMs - pending.createdAtMs >= this.maxBufferMs
    );
  }
}

function shouldSplitPending(
  pending: PendingSegment,
  transcript: TranscriptResult,
  nowMs: number,
  maxBufferMs: number,
) {
  const previous = pending.parts.at(-1);
  return (
    previous?.language !== transcript.language ||
    nowMs - pending.createdAtMs >= maxBufferMs
  );
}

function mergePending(pending: PendingSegment): TranscriptResult {
  const first = pending.parts[0];
  const last = pending.parts.at(-1) ?? first;
  return {
    segmentId: first.segmentId,
    text: mergeTranscriptText(
      pending.parts.map((part) => part.text),
      first.language,
    ),
    language: first.language,
    confidence: mergedConfidence(pending.parts) ?? last.confidence,
  };
}

function mergeTranscriptText(parts: string[], language: string) {
  const merged: string[] = [];
  for (const part of parts) {
    const text = part.trim();
    if (!text) continue;
    const previous = merged.at(-1);
    if (!previous) {
      merged.push(text);
      continue;
    }
    const joinPrevious = stripIncompleteJoinPunctuation(previous, language);
    merged[merged.length - 1] = shouldJoinWithoutSpace(joinPrevious, text)
      ? `${joinPrevious}${text}`
      : `${joinPrevious} ${text}`;
  }
  return merged.join(" ").replace(/\s+([,.!?;:])/g, "$1").trim();
}

function stripIncompleteJoinPunctuation(text: string, language: string) {
  if (!/[.。]$/u.test(text)) return text;
  return shouldHoldForNextSegment(text, language)
    ? text.replace(/[.。]+$/u, "").trim()
    : text;
}

function shouldJoinWithoutSpace(previous: string, next: string) {
  return /[\u4e00-\u9fff]$/u.test(previous) || /^[\u4e00-\u9fff]/u.test(next);
}

function mergedConfidence(parts: TranscriptResult[]) {
  const values = parts
    .map((part) => part.confidence)
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) return undefined;
  return Math.min(...values);
}

export function shouldHoldForNextSegment(text: string, language: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/[！？!?]$/u.test(trimmed)) return false;
  if (/[,，、;；:：]$/u.test(trimmed)) return true;
  const normalized = trimmed.replace(/[.。]+$/u, "");
  if (/[.。]$/u.test(trimmed)) {
    return language === "zh"
      ? hasChineseContinuationSuffix(normalized)
      : hasEnglishContinuationSuffix(normalized);
  }

  return language === "zh"
    ? hasChineseContinuationSuffix(trimmed)
    : hasEnglishContinuationSuffix(trimmed);
}

function hasChineseContinuationSuffix(text: string) {
  const normalized = text.replace(/[\s,，、;；:：.。!！?？]+$/gu, "");
  return chineseContinuationSuffixes.some((suffix) => normalized.endsWith(suffix));
}

function hasEnglishContinuationSuffix(text: string) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z'\s-]+$/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  const last = words.at(-1) ?? "";
  const lastTwo = words.slice(-2).join(" ");
  const lastThree = words.slice(-3).join(" ");
  return englishContinuationSuffixes.some(
    (suffix) => suffix === last || suffix === lastTwo || suffix === lastThree,
  );
}

function textLength(text: string) {
  return Array.from(text).length;
}
