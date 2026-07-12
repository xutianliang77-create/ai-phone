import type { TranscriptResult } from "../asr/asr-provider.js";
import { shouldHoldForNextSegment } from "./segment-boundary.js";
import { analyzeTurnLanguage } from "./turn-language-profile.js";

export function mergeTranscriptParts(parts: TranscriptResult[]): TranscriptResult {
  const first = parts[0];
  const last = parts.at(-1) ?? first;
  const text = parts
    .slice(1)
    .reduce(
      (merged, part, index) => mergeText(
        merged,
        part.text,
        first.language,
        parts[index].endpointReason === "max_duration",
      ),
      first.text.trim(),
    );
  const languageProfile = analyzeTurnLanguage(text, first.language);
  return {
    segmentId: first.segmentId,
    ...(first.turnId ? { turnId: first.turnId } : {}),
    ...(parts.some((part) => typeof part.revision === "number")
      ? { revision: Math.max(...parts.map((part) => part.revision ?? 0)) }
      : {}),
    text,
    language: first.language,
    ...languageProfile,
    confidence: mergedConfidence(parts) ?? last.confidence,
    ...(last.endpointReason ? { endpointReason: last.endpointReason } : {}),
    ...(first.speaker ? { speaker: first.speaker } : {}),
    ...(mergedTiming(parts) ? { timing: mergedTiming(parts) } : {}),
  };
}

function mergedTiming(parts: TranscriptResult[]) {
  const timings = parts
    .map((part) => part.timing)
    .filter((timing): timing is NonNullable<TranscriptResult["timing"]> =>
      timing !== undefined
    );
  if (timings.length === 0) return undefined;
  return {
    startMs: Math.min(...timings.map((timing) => timing.startMs)),
    endMs: Math.max(...timings.map((timing) => timing.endMs)),
    source: timings.every((timing) => timing.source === timings[0].source)
      ? timings[0].source
      : "estimated" as const,
    ...(timings.some((timing) => timing.overlap) ? { overlap: true } : {}),
    ...(mergedActiveSpeakerIds(timings).length > 0
      ? { activeSpeakerIds: mergedActiveSpeakerIds(timings) }
      : {}),
  };
}

function mergedActiveSpeakerIds(
  timings: Array<NonNullable<TranscriptResult["timing"]>>,
) {
  return Array.from(new Set(timings.flatMap(
    (timing) => timing.activeSpeakerIds ?? [],
  )));
}

export function canonicalSegmentText(text: string) {
  return text
    .toLowerCase()
    .replace(/[\s,，、;；:：.。!！?？'"“”‘’]+/gu, "")
    .trim();
}

function mergeText(
  previousText: string,
  nextText: string,
  language: string,
  hardContinuation = false,
) {
  const previous = hardContinuation
    ? previousText.trim().replace(/[.。]+$/u, "").trim()
    : stripIncompleteJoinPunctuation(previousText.trim(), language);
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
