import type { TranscriptEvent } from "@translation/contracts";
import type { TranscriptResult } from "../asr/asr-provider.js";
import type { SpeakerSpan } from "./speaker-attribution-provider.js";
import {
  absoluteRevisionSpans,
  mapRevisionLabels,
  validateSpeakerRevision,
} from "./speaker-revision-evidence.js";
import type {
  SpeakerRevisionResult,
  SpeakerRevisionSpan,
} from "./speaker-revision-provider.js";
import {
  crossesBoundary,
} from "./speaker-transcript-attribution.js";
import {
  splitTranscriptAtSpeakerBoundaries,
  type ConfirmedSpeakerBoundary,
  type SpeakerTokenSplitRejectionReason,
} from "./speaker-token-boundary-split.js";

export type StoredTranscriptFinal = Omit<TranscriptEvent, "type"> & {
  type: "transcript.final";
};

export type HighContextSplitRejectionReason =
  | "unsupported_provider"
  | "invalid_revision"
  | "no_baseline_cardinality"
  | "cardinality_mismatch"
  | "label_mapping_mismatch"
  | "no_sequential_boundaries"
  | "no_crossing_transcript"
  | `token_split_${SpeakerTokenSplitRejectionReason}`;

export type HighContextTokenSplitPlan =
  | {
      accepted: true;
      transcripts: TranscriptResult[];
      parentSegmentIds: string[];
      skippedParents: SkippedTokenSplitParent[];
      labelMapping: Record<string, string>;
    }
  | {
      accepted: false;
      reason: HighContextSplitRejectionReason;
      transcripts: [];
      parentSegmentIds: [];
      skippedParents: SkippedTokenSplitParent[];
      labelMapping: Record<string, string>;
    };

export interface SkippedTokenSplitParent {
  segmentId: string;
  reason: SpeakerTokenSplitRejectionReason;
}

interface SpeakerRun extends SpeakerSpan {
  turnId: string;
}

const PROVIDER = "sortformer_high_context";
const MAX_SEQUENTIAL_GAP_MS = 1_400;

export function planHighContextTokenSplits(
  revision: SpeakerRevisionResult,
  segments: StoredTranscriptFinal[],
  protectedTerms: string[] = [],
  confirmedLabelMapping?: Record<string, string>,
): HighContextTokenSplitPlan {
  if (revision.provider !== PROVIDER) {
    return rejected("unsupported_provider");
  }
  if (validateSpeakerRevision(revision)) {
    return rejected("invalid_revision");
  }
  if (segments.some((segment) => segment.sessionId !== revision.sessionId)) {
    return rejected("invalid_revision");
  }

  const baselineSpeakerIds = confirmedLabelMapping
    ? new Set(Object.values(confirmedLabelMapping))
    : new Set(segments.flatMap((segment) => {
        const speakerId = segment.speaker?.speakerId;
        return speakerId && speakerId !== "unknown" ? [speakerId] : [];
      }));
  if (baselineSpeakerIds.size === 0) {
    return rejected("no_baseline_cardinality");
  }
  if (revision.speakerCount !== baselineSpeakerIds.size) {
    return rejected("cardinality_mismatch");
  }

  const absoluteSpans = absoluteRevisionSpans(revision);
  const labelMapping = confirmedLabelMapping ??
    mapRevisionLabels(absoluteSpans, segments);
  const mappedIds = new Set(Object.values(labelMapping));
  if (
    mappedIds.size !== baselineSpeakerIds.size ||
    [...mappedIds].some((speakerId) => !baselineSpeakerIds.has(speakerId))
  ) {
    return rejected("label_mapping_mismatch", labelMapping);
  }

  const evidenceSpans = mappedNonOverlapSpans(absoluteSpans, labelMapping);
  const runs = sequentialRuns(evidenceSpans, revision.generation);
  const boundaries = boundariesFor(runs);
  if (boundaries.length === 0) {
    return rejected("no_sequential_boundaries", labelMapping);
  }
  const confirmedSpeaker = (speakerId: string) =>
    baselineSpeakerIds.has(speakerId);
  const splitTranscripts: TranscriptResult[] = [];
  const parentSegmentIds: string[] = [];
  const skippedParents: SkippedTokenSplitParent[] = [];

  for (const segment of orderedSegments(segments)) {
    const transcript = transcriptResult(segment);
    const crossed = boundaries.filter((boundary) =>
      crossesBoundary(transcript, boundary.boundaryMs)
    );
    if (crossed.length === 0 || transcript.timing?.overlap === true) continue;
    const split = splitTranscriptAtSpeakerBoundaries(
      transcript,
      crossed,
      evidenceSpans,
      confirmedSpeaker,
      protectedTerms,
    );
    if (!split.accepted) {
      skippedParents.push({
        segmentId: segment.segmentId,
        reason: split.reason,
      });
      continue;
    }
    const revisionNumber = (segment.revision ?? 0) + 1;
    splitTranscripts.push(...split.transcripts.map((child) => ({
      ...child,
      revision: revisionNumber,
    })));
    parentSegmentIds.push(segment.segmentId);
  }

  if (splitTranscripts.length === 0) {
    const firstRejection = skippedParents[0];
    return rejected(
      firstRejection
        ? `token_split_${firstRejection.reason}`
        : "no_crossing_transcript",
      labelMapping,
      skippedParents,
    );
  }
  return {
    accepted: true,
    transcripts: splitTranscripts,
    parentSegmentIds,
    skippedParents,
    labelMapping,
  };
}

function sequentialRuns(
  spans: SpeakerSpan[],
  generation: number,
): SpeakerRun[] {
  const ordered = spans
    .sort((left, right) =>
      left.startMs - right.startMs || left.endMs - right.endMs
    );
  const runs: SpeakerRun[] = [];
  for (const span of ordered) {
    const previous = runs.at(-1);
    if (
      previous?.speakerId === span.speakerId
    ) {
      const previousDuration = previous.endMs - previous.startMs;
      const spanDuration = span.endMs - span.startMs;
      previous.confidence = weightedConfidence(
        previous.confidence,
        previousDuration,
        span.confidence,
        spanDuration,
      );
      previous.endMs = Math.max(previous.endMs, span.endMs);
      continue;
    }
    runs.push({
      ...span,
      turnId: `speaker_revision_${generation}_turn_${runs.length + 1}`,
    });
  }
  return runs;
}

function mappedNonOverlapSpans(
  spans: SpeakerRevisionSpan[],
  labelMapping: Record<string, string>,
): SpeakerSpan[] {
  return spans
    .filter((span) => span.overlap !== true)
    .map((span) => ({
      ...span,
      speakerId: labelMapping[span.speakerId] ?? "unknown",
      final: true,
    }))
    .filter((span) => span.speakerId !== "unknown");
}

function boundariesFor(runs: SpeakerRun[]): ConfirmedSpeakerBoundary[] {
  const boundaries: ConfirmedSpeakerBoundary[] = [];
  for (let index = 1; index < runs.length; index += 1) {
    const previous = runs[index - 1];
    const next = runs[index];
    const gapMs = next.startMs - previous.endMs;
    if (
      previous.speakerId === next.speakerId ||
      gapMs < 0 ||
      gapMs > MAX_SEQUENTIAL_GAP_MS
    ) continue;
    boundaries.push({
      previousSpeakerId: previous.speakerId,
      nextSpeakerId: next.speakerId,
      previousTurnId: previous.turnId,
      nextTurnId: next.turnId,
      boundaryMs: Math.round((previous.endMs + next.startMs) / 2),
      confidence: Math.min(
        previous.confidence ?? 0,
        next.confidence ?? 0,
      ),
    });
  }
  return boundaries;
}

function transcriptResult(segment: StoredTranscriptFinal): TranscriptResult {
  return {
    segmentId: segment.segmentId,
    turnId: segment.turnId,
    revision: segment.revision,
    isFinal: true,
    text: segment.rawText ?? segment.text,
    language: segment.language,
    dominantLanguage: segment.dominantLanguage,
    detectedLanguages: segment.detectedLanguages,
    mixedLanguage: segment.mixedLanguage,
    confidence: segment.confidence,
    speaker: segment.speaker,
    timing: segment.timing,
    tokenTimings: segment.rawTokenTimings ?? segment.tokenTimings,
    endpointReason: segment.vadContext?.endpointReason,
    vadContext: segment.vadContext,
  };
}

function orderedSegments(segments: StoredTranscriptFinal[]) {
  return [...segments].sort((left, right) =>
    (left.timing?.startMs ?? Number.MAX_SAFE_INTEGER) -
      (right.timing?.startMs ?? Number.MAX_SAFE_INTEGER)
  );
}

function weightedConfidence(
  left: number | undefined,
  leftWeight: number,
  right: number | undefined,
  rightWeight: number,
) {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return (left * leftWeight + right * rightWeight) /
    Math.max(1, leftWeight + rightWeight);
}

function rejected(
  reason: HighContextSplitRejectionReason,
  labelMapping: Record<string, string> = {},
  skippedParents: SkippedTokenSplitParent[] = [],
): HighContextTokenSplitPlan {
  return {
    accepted: false,
    reason,
    transcripts: [],
    parentSegmentIds: [],
    skippedParents,
    labelMapping,
  };
}
