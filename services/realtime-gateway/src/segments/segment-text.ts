import type { TranscriptResult } from "../asr/asr-provider.js";
import { shouldHoldForNextSegment } from "./segment-boundary.js";

export function mergeTranscriptParts(parts: TranscriptResult[]): TranscriptResult {
  const first = parts[0];
  const last = parts.at(-1) ?? first;
  const text = parts
    .slice(1)
    .reduce(
      (merged, part) => mergeText(merged, part.text, first.language),
      first.text.trim(),
    );
  return {
    segmentId: first.segmentId,
    text,
    language: first.language,
    confidence: mergedConfidence(parts) ?? last.confidence,
  };
}

export function canonicalSegmentText(text: string) {
  return text
    .toLowerCase()
    .replace(/[\s,，、;；:：.。!！?？'"“”‘’]+/gu, "")
    .trim();
}

function mergeText(previousText: string, nextText: string, language: string) {
  const previous = stripIncompleteJoinPunctuation(previousText.trim(), language);
  const next = nextText.trim();
  if (!previous) return next;
  if (!next) return previous;

  const previousCanonical = canonicalSegmentText(previous);
  const nextCanonical = canonicalSegmentText(next);
  if (nextCanonical.startsWith(previousCanonical)) return next;
  if (previousCanonical.startsWith(nextCanonical)) return previous;

  const overlap = overlapLength(previous, next, language);
  const remainder = overlap > 0 ? next.slice(overlap).trimStart() : next;
  if (!remainder) return previous;
  return shouldJoinWithoutSpace(previous, remainder)
    ? `${previous}${remainder}`
    : `${previous} ${remainder}`;
}

function stripIncompleteJoinPunctuation(text: string, language: string) {
  if (!/[.。]$/u.test(text) || !shouldHoldForNextSegment(text, language)) return text;
  return text.replace(/[.。]+$/u, "").trim();
}

function overlapLength(previous: string, next: string, language: string) {
  const previousLower = previous.toLowerCase();
  const nextLower = next.toLowerCase();
  const minimum = 2;
  const maximum = Math.min(previous.length, next.length);
  for (let length = maximum; length >= minimum; length -= 1) {
    if (previousLower.slice(-length) !== nextLower.slice(0, length)) continue;
    if (language !== "zh" && !isEnglishWordOverlap(previous, next, length)) continue;
    return length;
  }
  return 0;
}

function isEnglishWordOverlap(previous: string, next: string, length: number) {
  const previousStart = previous.length - length;
  const before = previousStart > 0 ? previous[previousStart - 1] : " ";
  const after = length < next.length ? next[length] : " ";
  return !/[A-Za-z]/u.test(before) && !/[A-Za-z]/u.test(after);
}

function shouldJoinWithoutSpace(previous: string, next: string) {
  return /[\u4e00-\u9fff]$/u.test(previous) || /^[\u4e00-\u9fff]/u.test(next);
}

function mergedConfidence(parts: TranscriptResult[]) {
  const values = parts
    .map((part) => part.confidence)
    .filter((value): value is number => typeof value === "number");
  return values.length > 0 ? Math.min(...values) : undefined;
}
