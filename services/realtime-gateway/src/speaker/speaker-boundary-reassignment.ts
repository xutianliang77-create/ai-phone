import type { TranscriptResult } from "../asr/asr-provider.js";
import type { SpeechTurnBoundary } from "./speech-turn-coordinator.js";

export interface SpeakerBoundaryReassignmentPlan {
  previous: TranscriptResult;
  next: TranscriptResult;
  movedText: string;
  movedCharacterCount: number;
}

export type SpeakerBoundaryReassignmentRejectionReason =
  | "unsafe_evidence"
  | "suffix_alignment"
  | "previous_result"
  | "witness_next_alignment"
  | "revision_growth";

export interface SpeakerBoundaryReassignmentDecision {
  plan: SpeakerBoundaryReassignmentPlan | null;
  rejectionReason?: SpeakerBoundaryReassignmentRejectionReason;
}

interface SpeakerBoundaryReassignmentInput {
  previous: TranscriptResult;
  witness: TranscriptResult;
  next: TranscriptResult;
  boundary: SpeechTurnBoundary;
}

export function planSpeakerBoundaryReassignment(
  input: SpeakerBoundaryReassignmentInput,
) {
  return evaluateSpeakerBoundaryReassignment(input).plan;
}

export function evaluateSpeakerBoundaryReassignment(
  input: SpeakerBoundaryReassignmentInput,
): SpeakerBoundaryReassignmentDecision {
  const { previous, witness, next, boundary } = input;
  if (!safeTranscriptEvidence(previous, witness, next, boundary)) {
    return rejected("unsafe_evidence");
  }
  const suffix = fuzzySuffixPrefix(previous.text, witness.text);
  if (!suffix) return rejected("suffix_alignment");
  const previousText = removeNormalizedSuffix(previous.text, suffix.leftLength);
  const nextText = mergeWitnessWithNext(witness.text, next.text);
  if (!previousText || normalized(previousText).length < 4) {
    return rejected("previous_result");
  }
  if (!nextText) return rejected("witness_next_alignment");
  if (!safeRevisionGrowth(suffix, witness.text, next.text, nextText)) {
    return rejected("revision_growth");
  }
  return {
    plan: {
      previous: {
        ...previous,
        revision: (previous.revision ?? 0) + 1,
        text: ensureSentenceEnd(previousText),
        endpointReason: "speaker_boundary",
        timing: {
          ...previous.timing!,
          endMs: boundary.boundaryMs,
          overlap: false,
          activeSpeakerIds: [boundary.previousSpeakerId],
        },
        ...(previous.vadContext
          ? {
              vadContext: {
                ...previous.vadContext,
                endpointReason: "speaker_boundary" as const,
              },
            }
          : {}),
      },
      next: {
        ...next,
        revision: (next.revision ?? 0) + 1,
        text: nextText,
        timing: {
          ...next.timing!,
          startMs: boundary.boundaryMs,
          overlap: false,
          activeSpeakerIds: [boundary.nextSpeakerId],
        },
      },
      movedText: suffix.leftText,
      movedCharacterCount: Array.from(suffix.leftText).length,
    },
  };
}

function rejected(
  rejectionReason: SpeakerBoundaryReassignmentRejectionReason,
): SpeakerBoundaryReassignmentDecision {
  return { plan: null, rejectionReason };
}

function safeRevisionGrowth(
  suffix: Alignment,
  witnessText: string,
  originalNextText: string,
  revisedNextText: string,
) {
  const witnessLength = normalized(witnessText).length;
  const growth = normalized(revisedNextText).length -
    normalized(originalNextText).length;
  return witnessLength <= 48 &&
    growth >= Math.max(2, suffix.leftLength - 2) &&
    growth <= suffix.leftLength + 4;
}

function safeTranscriptEvidence(
  previous: TranscriptResult,
  witness: TranscriptResult,
  next: TranscriptResult,
  boundary: SpeechTurnBoundary,
) {
  if (!previous.turnId || !next.turnId || witness.turnId !== next.turnId ||
      previous.turnId === next.turnId ||
      speakerId(previous) !== boundary.previousSpeakerId ||
      speakerId(witness) !== boundary.nextSpeakerId ||
      speakerId(next) !== boundary.nextSpeakerId ||
      previous.language !== witness.language || previous.language !== next.language ||
      !safeTiming(previous) || !safeTiming(witness) || !safeTiming(next)) {
    return false;
  }
  const overrunMs = previous.timing!.endMs - boundary.boundaryMs;
  if (previous.timing!.startMs >= boundary.boundaryMs ||
      overrunMs < 80 || overrunMs > 1_400) return false;
  const witnessDurationMs = witness.timing!.endMs - witness.timing!.startMs;
  return witness.timing!.startMs >= boundary.boundaryMs - 200 &&
    witnessDurationMs >= 1_800 && witnessDurationMs <= 2_600 &&
    next.timing!.endMs > boundary.boundaryMs &&
    next.timing!.startMs >= boundary.boundaryMs - 200;
}

function safeTiming(transcript: TranscriptResult) {
  const timing = transcript.timing;
  if (!timing || timing.overlap === true) return false;
  const active = [...new Set(timing.activeSpeakerIds ?? [])];
  return active.length <= 1 &&
    (active.length === 0 || active[0] === speakerId(transcript));
}

function speakerId(transcript: TranscriptResult) {
  const speaker = transcript.speaker;
  if (!speaker || speaker.speakerId === "unknown" ||
      speaker.role === "unknown" || speaker.source === "unknown") return "";
  return speaker.speakerId;
}

function fuzzySuffixPrefix(leftText: string, rightText: string) {
  const left = normalized(leftText);
  const right = normalized(rightText);
  let best: Alignment | null = null;
  const maximum = Math.min(24, left.length, right.length + 2);
  for (let leftLength = 4; leftLength <= maximum; leftLength += 1) {
    const leftPart = left.slice(-leftLength);
    for (
      let rightLength = Math.max(4, leftLength - 2);
      rightLength <= Math.min(right.length, leftLength + 2);
      rightLength += 1
    ) {
      const rightPart = right.slice(0, rightLength);
      if (commonPrefixLength(leftPart, rightPart) < 2) continue;
      if (hasProtectedEntity(leftPart + rightPart) && leftPart !== rightPart) {
        continue;
      }
      const distance = levenshtein(leftPart, rightPart);
      const score = 1 - distance / Math.max(leftLength, rightLength);
      if (score < 0.75) continue;
      const candidate = { leftLength, rightLength, score, leftText: leftPart };
      if (!best || candidate.score > best.score ||
          candidate.score === best.score && candidate.leftLength > best.leftLength) {
        best = candidate;
      }
    }
  }
  return best;
}

interface Alignment {
  leftLength: number;
  rightLength: number;
  score: number;
  leftText: string;
}

function mergeWitnessWithNext(witnessText: string, nextText: string) {
  const witness = normalized(witnessText);
  const next = normalized(nextText);
  const maximum = Math.min(32, witness.length, next.length);
  let overlap = 0;
  for (let length = maximum; length >= 2; length -= 1) {
    if (witness.slice(-length) === next.slice(0, length)) {
      overlap = length;
      break;
    }
  }
  if (overlap === 0) return null;
  const remainder = removeNormalizedPrefix(nextText, overlap);
  if (!remainder) return witnessText.trim();
  const left = witnessText.trim().replace(/[.。]+$/u, "");
  return shouldJoinWithoutSpace(left, remainder)
    ? `${left}${remainder}`
    : `${left} ${remainder}`;
}

function removeNormalizedSuffix(text: string, length: number) {
  const entries = normalizedEntries(text);
  const first = entries[entries.length - length];
  if (!first) return "";
  return Array.from(text).slice(0, first.originalIndex).join("").trim()
    .replace(/[\s,，、;；:：]+$/gu, "");
}

function removeNormalizedPrefix(text: string, length: number) {
  const entries = normalizedEntries(text);
  const last = entries[length - 1];
  if (!last) return "";
  return Array.from(text).slice(last.originalIndex + 1).join("").trim()
    .replace(/^[\s,，、;；:：.。]+/gu, "");
}

function normalized(text: string) {
  return normalizedEntries(text).map((entry) => entry.character).join("");
}

function normalizedEntries(text: string) {
  return Array.from(text).map((character, originalIndex) => ({
    character: character.toLowerCase(),
    originalIndex,
  })).filter(({ character }) => !/[\s,，、;；:：.。!！?？'"“”‘’]/u.test(character));
}

function ensureSentenceEnd(text: string) {
  const trimmed = text.trim();
  return /[.。!！?？]$/u.test(trimmed) ? trimmed : `${trimmed}。`;
}

function shouldJoinWithoutSpace(left: string, right: string) {
  return /[\u4e00-\u9fff]$/u.test(left) || /^[\u4e00-\u9fff]/u.test(right);
}

function hasProtectedEntity(text: string) {
  return /[A-Za-z0-9零〇一二三四五六七八九十百千万亿两点元角分壹贰叁肆伍陆柒捌玖拾佰仟]/u
    .test(text);
}

function commonPrefixLength(left: string, right: string) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function levenshtein(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}
