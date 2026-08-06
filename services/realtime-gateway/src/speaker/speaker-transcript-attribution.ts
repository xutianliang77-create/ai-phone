import type {
  AsrProviderResult,
  TranscriptResult,
} from "../asr/asr-provider.js";
import type { SpeakerSpan } from "./speaker-attribution-provider.js";
import { evaluateSpeakerSpan } from "./speaker-segment-aligner.js";

export interface SpeakerBoundaryGuard {
  boundaryMs: number;
  previousSpeakerId: string;
  nextSpeakerId: string;
}

export function providerResult(results: TranscriptResult[]): AsrProviderResult {
  if (results.length === 0) return null;
  return results.length === 1 ? results[0] : results;
}

export function attributeSpeakerTranscripts(
  transcripts: TranscriptResult[],
  spans: SpeakerSpan[],
  fallbackSpeakerId: (transcript: TranscriptResult) => string | undefined,
  boundaries: SpeakerBoundaryGuard[] = [],
  isConfirmedSpeakerId: (speakerId: string) => boolean = () => true,
) {
  return transcripts.map((transcript) => {
    const crossedBoundaries = boundaries.filter((boundary) =>
      crossesBoundary(transcript, boundary.boundaryMs)
    );
    if (crossedBoundaries.length > 0) {
      return mixedSpeakerFallback(transcript, crossedBoundaries);
    }
    if (transcript.speaker?.speakerId !== undefined &&
      transcript.speaker.speakerId !== "unknown") {
      return transcript;
    }
    const { alignment, hasDirectEvidence } = evaluateSpeakerSpan(
      transcript.timing,
      spans,
    );
    if (
      alignment?.speaker.speakerId !== undefined &&
      alignment.speaker.speakerId !== "unknown" &&
      isConfirmedSpeakerId(alignment.speaker.speakerId)
    ) {
      return { ...transcript, ...alignment };
    }
    const stableSpeakerId = fallbackSpeakerId(transcript);
    if (stableSpeakerId && isConfirmedSpeakerId(stableSpeakerId)) {
      return {
        ...transcript,
        ...(alignment?.timing ? { timing: alignment.timing } : {}),
        speaker: {
          speakerId: stableSpeakerId,
          role: "speaker" as const,
          source: "diarization" as const,
        },
      };
    }
    if (
      alignment?.speaker.speakerId === "unknown" &&
      hasDirectEvidence
    ) {
      return { ...transcript, ...alignment };
    }
    return {
      ...transcript,
      ...(alignment?.timing ? { timing: alignment.timing } : {}),
      speaker: {
        speakerId: "unknown",
        role: "unknown" as const,
        source: "unknown" as const,
      },
    };
  }).sort((left, right) =>
    (left.timing?.startMs ?? 0) - (right.timing?.startMs ?? 0)
  );
}

export function removeOverlappingTranscripts(
  regular: TranscriptResult[],
  committed: TranscriptResult[],
) {
  return regular.filter((item) =>
    !committed.some((boundaryItem) => timingsOverlap(item, boundaryItem))
  );
}

export function crossesBoundary(
  transcript: TranscriptResult,
  boundaryMs: number,
) {
  if (!transcript.timing) return false;
  return transcript.timing.startMs < boundaryMs &&
    transcript.timing.endMs > boundaryMs;
}

export function turnForTranscript(
  transcript: TranscriptResult,
  boundaryMs: number | undefined,
  previous: { turnId: string; revision: number },
  next: { turnId: string; revision: number } | undefined,
) {
  if (!next || boundaryMs === undefined) return previous;
  if (transcript.timing && transcript.timing.startMs < boundaryMs) {
    return previous;
  }
  return next;
}

function timingsOverlap(left: TranscriptResult, right: TranscriptResult) {
  if (!left.timing || !right.timing) return false;
  return left.timing.startMs < right.timing.endMs &&
    right.timing.startMs < left.timing.endMs;
}

function mixedSpeakerFallback(
  transcript: TranscriptResult,
  boundaries: SpeakerBoundaryGuard[],
): TranscriptResult {
  const activeSpeakerIds = [...new Set([
    ...(transcript.timing?.activeSpeakerIds ?? []),
    ...boundaries.flatMap((boundary) => [
      boundary.previousSpeakerId,
      boundary.nextSpeakerId,
    ]),
  ])];
  return {
    ...transcript,
    speaker: {
      speakerId: "unknown",
      role: "unknown",
      source: "unknown",
    },
    ...(transcript.timing
      ? {
          timing: {
            ...transcript.timing,
            overlap: true,
            activeSpeakerIds,
          },
        }
      : {}),
  };
}
