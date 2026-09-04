import {
  isAsrTokenTimings,
  type AsrTokenTimingDto,
} from "@translation/contracts";
import type { SpeechTranscript } from "./speech-transcript.js";
import { shouldHoldForNextSegment } from "./segment-boundary.js";
import { analyzeTurnLanguage } from "./turn-language-profile.js";

export interface MergeTranscriptPartsOptions {
  allowSingleCharacterCjkOverlap?: boolean;
}

export function mergeTranscriptParts(
  parts: SpeechTranscript[],
  options: MergeTranscriptPartsOptions = {},
): SpeechTranscript {
  const first = parts[0];
  const last = parts.at(-1) ?? first;
  const content = mergeTranscriptContent(parts, options);
  const text = content.text;
  const languageProfile = analyzeTurnLanguage(text, first.language);
  const pipelineTiming = mergedPipelineTiming(parts);
  return {
    segmentId: first.segmentId,
    ...(first.speechId ? { speechId: first.speechId } : {}),
    ...(first.turnId ? { turnId: first.turnId } : {}),
    ...(parts.some((part) => typeof part.revision === "number")
      ? { revision: Math.max(...parts.map((part) => part.revision ?? 0)) }
      : {}),
    text,
    language: first.language,
    ...languageProfile,
    confidence: mergedConfidence(parts) ?? last.confidence,
    ...(last.endpointReason ? { endpointReason: last.endpointReason } : {}),
    ...(last.vadContext ? { vadContext: last.vadContext } : {}),
    ...(pipelineTiming ? { pipelineTiming } : {}),
    ...(first.speaker ? { speaker: first.speaker } : {}),
    ...(mergedTiming(parts) ? { timing: mergedTiming(parts) } : {}),
    ...(content.tokenTimings !== undefined
      ? { tokenTimings: content.tokenTimings }
      : {}),
  };
}

interface MergedTranscriptContent {
  text: string;
  tokenTimings?: AsrTokenTimingDto[];
}

function mergeTranscriptContent(
  parts: SpeechTranscript[],
  options: MergeTranscriptPartsOptions,
): MergedTranscriptContent {
  const first = parts[0];
  const firstRange = trimmedRange(first.text);
  let merged: MergedTranscriptContent = {
    text: firstRange.text,
    tokenTimings: remapTokens(
      first.tokenTimings,
      first.text,
      firstRange.start,
      firstRange.end,
      0,
    ),
  };
  for (let index = 1; index < parts.length; index += 1) {
    merged = mergeTranscriptContentPart(
      merged,
      parts[index],
      first.language,
      parts[index - 1].endpointReason === "max_duration",
      options.allowSingleCharacterCjkOverlap === true,
    );
  }
  return merged;
}

function mergeTranscriptContentPart(
  previousState: MergedTranscriptContent,
  nextPart: SpeechTranscript,
  language: string,
  hardContinuation: boolean,
  allowSingleCharacterCjkOverlap: boolean,
): MergedTranscriptContent {
  const previous = normalizedPreviousText(
    previousState.text,
    language,
    hardContinuation,
  );
  const previousTokens = remapTokens(
    previousState.tokenTimings,
    previousState.text,
    0,
    previous.length,
    0,
  );
  const nextRange = trimmedRange(nextPart.text);
  const next = nextRange.text;
  if (!previous) {
    return {
      text: next,
      tokenTimings: remapTokens(
        nextPart.tokenTimings,
        nextPart.text,
        nextRange.start,
        nextRange.end,
        0,
      ),
    };
  }
  if (!next) return { text: previous, tokenTimings: previousTokens };

  const previousCanonical = canonicalSegmentText(previous);
  const nextCanonical = canonicalSegmentText(next);
  if (nextCanonical.startsWith(previousCanonical)) {
    if (!next.startsWith(previous)) {
      return { text: next, tokenTimings: undefined };
    }
    const suffixTokens = remapTokens(
      nextPart.tokenTimings,
      nextPart.text,
      nextRange.start + previous.length,
      nextRange.end,
      previous.length,
    );
    return {
      text: next,
      tokenTimings: combinedTokens(previousTokens, suffixTokens, next),
    };
  }
  if (previousCanonical.startsWith(nextCanonical)) {
    return { text: previous, tokenTimings: previousTokens };
  }

  const overlap = overlapLength(
    previous,
    next,
    language,
    hardContinuation && allowSingleCharacterCjkOverlap,
  );
  const untrimmedRemainder = overlap > 0 ? next.slice(overlap) : next;
  const remainderLeading = untrimmedRemainder.length -
    untrimmedRemainder.trimStart().length;
  const nextIncludedStart = overlap + remainderLeading;
  const remainder = next.slice(nextIncludedStart);
  if (!remainder) return { text: previous, tokenTimings: previousTokens };
  const separator = shouldJoinWithoutSpace(previous, remainder) ? "" : " ";
  const text = `${previous}${separator}${remainder}`;
  const remainderTokens = remapTokens(
    nextPart.tokenTimings,
    nextPart.text,
    nextRange.start + nextIncludedStart,
    nextRange.end,
    previous.length + separator.length,
  );
  return {
    text,
    tokenTimings: combinedTokens(previousTokens, remainderTokens, text),
  };
}

function normalizedPreviousText(
  text: string,
  language: string,
  hardContinuation: boolean,
) {
  return hardContinuation
    ? text.trim().replace(/[.。]+$/u, "").trim()
    : stripIncompleteJoinPunctuation(text.trim(), language);
}

function trimmedRange(text: string) {
  const value = text.trim();
  const start = text.length - text.trimStart().length;
  return { text: value, start, end: start + value.length };
}

function remapTokens(
  tokens: AsrTokenTimingDto[] | undefined,
  sourceText: string,
  sourceStart: number,
  sourceEnd: number,
  outputStart: number,
) {
  if (tokens === undefined || !isAsrTokenTimings(tokens)) return undefined;
  const mapped: AsrTokenTimingDto[] = [];
  for (const token of tokens) {
    const start = token.characterStart;
    const end = token.characterEnd;
    if (start === undefined || end === undefined) return undefined;
    if (end <= sourceStart || start >= sourceEnd) continue;
    if (
      start < sourceStart || end > sourceEnd ||
      sourceText.slice(start, end) !== token.text
    ) return undefined;
    mapped.push({
      ...token,
      characterStart: outputStart + start - sourceStart,
      characterEnd: outputStart + end - sourceStart,
    });
  }
  return mapped;
}

function combinedTokens(
  left: AsrTokenTimingDto[] | undefined,
  right: AsrTokenTimingDto[] | undefined,
  text: string,
) {
  if (left === undefined || right === undefined) return undefined;
  const combined = [...left, ...right];
  if (
    !isAsrTokenTimings(combined) ||
    combined.some((token) =>
      token.characterStart === undefined ||
      token.characterEnd === undefined ||
      text.slice(token.characterStart, token.characterEnd) !== token.text
    )
  ) return undefined;
  return combined;
}

function mergedPipelineTiming(parts: SpeechTranscript[]) {
  const timings = parts
    .map((part) => part.pipelineTiming)
    .filter((timing): timing is NonNullable<SpeechTranscript["pipelineTiming"]> =>
      timing !== undefined
    );
  if (timings.length === 0) return undefined;
  return {
    ...minimumTiming(timings, "asrStartedAtMs"),
    ...maximumTiming(timings, "asrFinalAtMs"),
    ...minimumTiming(timings, "processingQueueEnteredAtMs"),
    ...maximumTiming(timings, "processingQueueReleasedAtMs"),
  };
}

function minimumTiming(
  timings: Array<NonNullable<SpeechTranscript["pipelineTiming"]>>,
  field: "asrStartedAtMs" | "processingQueueEnteredAtMs",
) {
  const values = timings
    .map((timing) => timing[field])
    .filter((value): value is number => value !== undefined);
  return values.length > 0 ? { [field]: Math.min(...values) } : {};
}

function maximumTiming(
  timings: Array<NonNullable<SpeechTranscript["pipelineTiming"]>>,
  field: "asrFinalAtMs" | "processingQueueReleasedAtMs",
) {
  const values = timings
    .map((timing) => timing[field])
    .filter((value): value is number => value !== undefined);
  return values.length > 0 ? { [field]: Math.max(...values) } : {};
}

function mergedTiming(parts: SpeechTranscript[]) {
  const timings = parts
    .map((part) => part.timing)
    .filter((timing): timing is NonNullable<SpeechTranscript["timing"]> =>
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
  timings: Array<NonNullable<SpeechTranscript["timing"]>>,
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

function stripIncompleteJoinPunctuation(text: string, language: string) {
  if (!/[.。]$/u.test(text) || !shouldHoldForNextSegment(text, language)) return text;
  return text.replace(/[.。]+$/u, "").trim();
}

function overlapLength(
  previous: string,
  next: string,
  language: string,
  allowSingleCharacterCjkOverlap: boolean,
) {
  const previousLower = previous.toLowerCase();
  const nextLower = next.toLowerCase();
  const minimum = allowSingleCharacterCjkOverlap ? 1 : 2;
  const maximum = Math.min(previous.length, next.length);
  for (let length = maximum; length >= minimum; length -= 1) {
    if (previousLower.slice(-length) !== nextLower.slice(0, length)) continue;
    if (length === 1 && !isSafeSingleCjkOverlap(next[0], language)) continue;
    if (language !== "zh" && !isEnglishWordOverlap(previous, next, length)) continue;
    return length;
  }
  return 0;
}

function isSafeSingleCjkOverlap(character: string, language: string) {
  return language === "zh" &&
    /\p{Script=Han}/u.test(character) &&
    !protectedSingleCharacterEntities.has(character);
}

const protectedSingleCharacterEntities = new Set(Array.from(
  "零〇一二三四五六七八九十百千万亿两点元角分壹贰叁肆伍陆柒捌玖拾佰仟",
));

function isEnglishWordOverlap(previous: string, next: string, length: number) {
  const previousStart = previous.length - length;
  const before = previousStart > 0 ? previous[previousStart - 1] : " ";
  const after = length < next.length ? next[length] : " ";
  return !/[A-Za-z]/u.test(before) && !/[A-Za-z]/u.test(after);
}

function shouldJoinWithoutSpace(previous: string, next: string) {
  return /[\u4e00-\u9fff]$/u.test(previous) || /^[\u4e00-\u9fff]/u.test(next);
}

function mergedConfidence(parts: SpeechTranscript[]) {
  const values = parts
    .map((part) => part.confidence)
    .filter((value): value is number => typeof value === "number");
  return values.length > 0 ? Math.min(...values) : undefined;
}
