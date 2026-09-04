import type { AsrTokenTimingDto } from "@translation/contracts";
import type { TranscriptResult } from "../asr/asr-provider.js";
import type { SpeakerSpan } from "./speaker-attribution-provider.js";
import { evaluateSpeakerSpan } from "./speaker-segment-aligner.js";
import { isProtectedSpeakerCut } from "./speaker-split-protected-surface.js";
export interface ConfirmedSpeakerBoundary {
  boundaryMs: number;
  previousSpeakerId: string;
  nextSpeakerId: string;
  confidence?: number;
  previousTurnId?: string;
  nextTurnId?: string;
}
export type SpeakerTokenSplitRejectionReason =
  | "not_final"
  | "missing_timing"
  | "missing_token_timing"
  | "invalid_token_timing"
  | "explicit_overlap"
  | "unconfirmed_boundary"
  | "turn_lineage_mismatch"
  | "protected_surface"
  | "no_safe_token_boundary"
  | "sortformer_evidence_mismatch"
  | "text_conservation_failed";

export type SpeakerTokenSplitResult =
  | { accepted: true; transcripts: TranscriptResult[] }
  | {
      accepted: false;
      reason: SpeakerTokenSplitRejectionReason;
      transcripts: [];
    };
interface TokenCut {
  tokenIndex: number;
  characterIndex: number;
  timeMs: number;
}
const MAX_BOUNDARY_SNAP_MS = 200;
const MIN_BOUNDARY_CONFIDENCE = 0.6;

export function splitTranscriptAtSpeakerBoundaries(
  transcript: TranscriptResult,
  boundaries: ConfirmedSpeakerBoundary[],
  sortformerSpans: SpeakerSpan[],
  isConfirmedSpeakerId: (speakerId: string) => boolean,
  protectedTerms: string[] = [],
): SpeakerTokenSplitResult {
  if (transcript.isFinal === false) return rejected("not_final");
  if (!transcript.timing) return rejected("missing_timing");
  if (transcript.timing.overlap === true) return rejected("explicit_overlap");
  const tokens = validatedTokens(transcript);
  if (tokens === "missing") return rejected("missing_token_timing");
  if (tokens === "invalid") return rejected("invalid_token_timing");

  const orderedBoundaries = [...boundaries].sort(
    (left, right) => left.boundaryMs - right.boundaryMs,
  );
  if (!validBoundaries(orderedBoundaries, isConfirmedSpeakerId)) {
    return rejected("unconfirmed_boundary");
  }
  if (!validTurnLineage(orderedBoundaries)) {
    return rejected("turn_lineage_mismatch");
  }

  const cuts: TokenCut[] = [];
  let minimumTokenIndex = 1;
  for (const boundary of orderedBoundaries) {
    const candidates = tokenCutCandidates(
      tokens,
      boundary.boundaryMs,
      minimumTokenIndex,
    );
    if (candidates.length === 0) {
      return rejected("no_safe_token_boundary");
    }
    const unprotected = candidates.filter((candidate) =>
      !isProtectedSpeakerCut(
        transcript.text,
        candidate.characterIndex,
        protectedTerms,
      )
    );
    if (unprotected.length === 0) return rejected("protected_surface");
    const cut = unprotected[0];
    cuts.push(cut);
    minimumTokenIndex = cut.tokenIndex + 1;
  }

  const children = buildChildren(
    transcript,
    tokens,
    orderedBoundaries,
    cuts,
  );
  if (!children || !textConserved(transcript.text, children)) {
    return rejected("text_conservation_failed");
  }
  const confirmedChildren = confirmChildrenWithSortformer(
    children,
    sortformerSpans,
    isConfirmedSpeakerId,
  );
  if (!confirmedChildren) {
    return rejected("sortformer_evidence_mismatch");
  }
  return { accepted: true, transcripts: confirmedChildren };
}

function validatedTokens(
  transcript: TranscriptResult,
): AsrTokenTimingDto[] | "missing" | "invalid" {
  const tokens = transcript.tokenTimings;
  if (!tokens || tokens.length < 2) return "missing";
  const timing = transcript.timing!;
  let previousStartMs = -1;
  let previousCharacterEnd = -1;
  for (const token of tokens) {
    if (
      token.startMs < timing.startMs ||
      token.endMs > timing.endMs ||
      token.startMs < previousStartMs ||
      token.endMs < token.startMs ||
      token.characterStart === undefined ||
      token.characterEnd === undefined ||
      token.characterStart < previousCharacterEnd ||
      token.characterEnd <= token.characterStart ||
      token.characterEnd > transcript.text.length ||
      transcript.text.slice(token.characterStart, token.characterEnd) !==
        token.text
    ) return "invalid";
    previousStartMs = token.startMs;
    previousCharacterEnd = token.characterEnd;
  }
  return tokens;
}

function validBoundaries(
  boundaries: ConfirmedSpeakerBoundary[],
  isConfirmedSpeakerId: (speakerId: string) => boolean,
) {
  return boundaries.length > 0 && boundaries.every((boundary, index) =>
    Number.isFinite(boundary.boundaryMs) &&
    boundary.boundaryMs > 0 &&
    typeof boundary.confidence === "number" &&
    boundary.confidence >= MIN_BOUNDARY_CONFIDENCE && boundary.confidence <= 1 &&
    isConfirmedSpeakerId(boundary.previousSpeakerId) &&
    isConfirmedSpeakerId(boundary.nextSpeakerId) &&
    boundary.previousSpeakerId !== boundary.nextSpeakerId &&
    (index === 0 || boundary.boundaryMs > boundaries[index - 1].boundaryMs)
  );
}

function validTurnLineage(boundaries: ConfirmedSpeakerBoundary[]) {
  return boundaries.every((boundary, index) =>
    !!boundary.previousTurnId &&
    !!boundary.nextTurnId &&
    boundary.previousTurnId !== boundary.nextTurnId &&
    (index === 0 || (
      boundaries[index - 1].nextSpeakerId === boundary.previousSpeakerId &&
      boundaries[index - 1].nextTurnId === boundary.previousTurnId
    ))
  );
}

function tokenCutCandidates(
  tokens: AsrTokenTimingDto[],
  boundaryMs: number,
  minimumTokenIndex: number,
) {
  const candidates: Array<TokenCut & { score: number }> = [];
  for (
    let tokenIndex = minimumTokenIndex;
    tokenIndex < tokens.length;
    tokenIndex += 1
  ) {
    const left = tokens[tokenIndex - 1];
    const right = tokens[tokenIndex];
    if (
      left.characterEnd === undefined ||
      right.characterStart === undefined ||
      left.characterEnd > right.characterStart ||
      left.endMs > right.startMs
    ) continue;
    const distance = distanceToInterval(
      boundaryMs,
      left.endMs,
      right.startMs,
    );
    if (distance > MAX_BOUNDARY_SNAP_MS) continue;
    const timeMs = Math.min(
      Math.max(boundaryMs, left.endMs),
      right.startMs,
    );
    candidates.push({
      tokenIndex,
      characterIndex: right.characterStart,
      timeMs,
      score: distance * 10_000 + Math.abs(
        boundaryMs - (left.endMs + right.startMs) / 2,
      ),
    });
  }
  return candidates
    .sort((left, right) => left.score - right.score)
    .map(({ score: _score, ...candidate }) => candidate);
}

function buildChildren(
  transcript: TranscriptResult,
  tokens: AsrTokenTimingDto[],
  boundaries: ConfirmedSpeakerBoundary[],
  cuts: TokenCut[],
): TranscriptResult[] | null {
  const characterBounds = [
    0,
    ...cuts.map((cut) => cut.characterIndex),
    transcript.text.length,
  ];
  const timeBounds = [
    transcript.timing!.startMs,
    ...cuts.map((cut) => cut.timeMs),
    transcript.timing!.endMs,
  ];
  const tokenBounds = [0, ...cuts.map((cut) => cut.tokenIndex), tokens.length];
  const speakers = [
    boundaries[0].previousSpeakerId,
    ...boundaries.map((boundary) => boundary.nextSpeakerId),
  ];
  const turns = [
    boundaries[0].previousTurnId!,
    ...boundaries.map((boundary) => boundary.nextTurnId!),
  ];
  const children: TranscriptResult[] = [];
  for (let index = 0; index < speakers.length; index += 1) {
    if (timeBounds[index] >= timeBounds[index + 1]) return null;
    const trimmed = trimmedRange(
      transcript.text,
      characterBounds[index],
      characterBounds[index + 1],
    );
    if (!trimmed || tokenBounds[index] >= tokenBounds[index + 1]) return null;
    const childTokens = tokens
      .slice(tokenBounds[index], tokenBounds[index + 1])
      .map((token) => rebaseToken(token, trimmed.start));
    if (childTokens.some((token) =>
      token.startMs < timeBounds[index] ||
      token.endMs > timeBounds[index + 1] ||
      token.characterStart === undefined ||
      token.characterEnd === undefined ||
      token.characterStart < 0 ||
      token.characterEnd > trimmed.text.length
    )) return null;
    const isLast = index === speakers.length - 1;
    children.push({
      ...transcript,
      segmentId: index === 0
        ? transcript.segmentId
        : `${transcript.segmentId}:speaker:${index}`,
      turnId: turns[index],
      text: trimmed.text,
      speaker: diarizedSpeaker(speakers[index]),
      timing: {
        startMs: timeBounds[index],
        endMs: timeBounds[index + 1],
        source: "model",
        overlap: false,
      },
      tokenTimings: childTokens,
      endpointReason: isLast ? transcript.endpointReason : "speaker_boundary",
      ...(transcript.vadContext
        ? {
            vadContext: isLast
              ? transcript.vadContext
              : { ...transcript.vadContext, endpointReason: "speaker_boundary" },
          }
        : {}),
    });
  }
  return children;
}

function confirmChildrenWithSortformer(
  children: TranscriptResult[],
  spans: SpeakerSpan[],
  isConfirmedSpeakerId: (speakerId: string) => boolean,
) {
  const confirmed: TranscriptResult[] = [];
  for (const child of children) {
    const expectedSpeakerId = child.speaker!.speakerId;
    const evidence = evaluateSpeakerSpan(child.timing, spans);
    if (
      !isConfirmedSpeakerId(expectedSpeakerId) ||
      !evidence.hasDirectEvidence ||
      !evidence.alignment ||
      evidence.alignment.speaker.speakerId !== expectedSpeakerId ||
      evidence.alignment.timing.overlap === true
    ) return null;
    confirmed.push({
      ...child,
      speaker: evidence.alignment.speaker,
    });
  }
  return confirmed;
}

function rebaseToken(token: AsrTokenTimingDto, offset: number) {
  return {
    ...token,
    characterStart: token.characterStart! - offset,
    characterEnd: token.characterEnd! - offset,
  };
}

function trimmedRange(text: string, start: number, end: number) {
  const raw = text.slice(start, end);
  const value = raw.trim();
  if (!value) return null;
  const leading = raw.length - raw.trimStart().length;
  return { text: value, start: start + leading };
}

function textConserved(parent: string, children: TranscriptResult[]) {
  return withoutWhitespace(children.map((child) => child.text).join("")) ===
    withoutWhitespace(parent);
}

function withoutWhitespace(value: string) {
  return value.replace(/\s+/gu, "");
}

function distanceToInterval(value: number, start: number, end: number) {
  if (value < start) return start - value;
  if (value > end) return value - end;
  return 0;
}

function diarizedSpeaker(speakerId: string) {
  return {
    speakerId,
    role: "speaker" as const,
    source: "diarization" as const,
  };
}

function rejected(
  reason: SpeakerTokenSplitRejectionReason,
): SpeakerTokenSplitResult {
  return { accepted: false, reason, transcripts: [] };
}
