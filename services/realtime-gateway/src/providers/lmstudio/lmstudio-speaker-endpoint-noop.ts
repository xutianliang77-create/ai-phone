import type { SpeakerEndpointNoopRejectionReason } from
  "@translation/contracts";
import type { AsrSpeakerBoundaryEvidence } from
  "../../asr/asr-provider.js";
import type { TranscriptResult } from "../../asr/asr-provider.js";

type SpeakerBoundary = AsrSpeakerBoundaryEvidence["boundaries"][number];

export interface SpeakerEndpointTranscriptEvidence {
  segmentId: string;
  turnId?: string;
  speakerId?: string;
  speakerKnown: boolean;
  startMs: number;
  endMs: number;
  overlap: boolean;
  lastTokenEndMs?: number;
}

export type SpeakerEndpointNoopDecision =
  | {
      accepted: true;
      previousSegmentId: string;
      nextSegmentId: string;
      previousGapMs: number;
      nextGapMs: number;
    }
  | { accepted: false; reason: SpeakerEndpointNoopRejectionReason };

const MAX_ENDPOINT_GAP_MS = 1_500;

export class SpeakerEndpointTranscriptHistory {
  private readonly items = new Map<
    string,
    SpeakerEndpointTranscriptEvidence
  >();

  remember(transcript: TranscriptResult) {
    const timing = transcript.timing;
    if (transcript.isFinal === false || !timing) return;
    const speaker = transcript.speaker;
    this.items.set(transcript.segmentId, {
      segmentId: transcript.segmentId,
      turnId: transcript.turnId,
      speakerId: speaker?.speakerId,
      speakerKnown: Boolean(
        speaker && speaker.speakerId !== "unknown" &&
        speaker.role !== "unknown" && speaker.source !== "unknown",
      ),
      startMs: timing.startMs,
      endMs: timing.endMs,
      overlap: timing.overlap === true,
      ...lastTokenEnd(transcript),
    });
    while (this.items.size > 128) {
      this.items.delete(this.items.keys().next().value!);
    }
  }

  values() {
    return [...this.items.values()];
  }
}

export function evaluateSpeakerEndpointNoop(
  boundary: SpeakerBoundary,
  transcripts: SpeakerEndpointTranscriptEvidence[],
): SpeakerEndpointNoopDecision {
  if (transcripts.some((transcript) =>
    transcript.startMs < boundary.boundaryMs &&
    textEndMs(transcript) > boundary.boundaryMs
  )) return rejected("crossing_parent");
  const previous = transcripts
    .filter((transcript) =>
      transcript.turnId === boundary.previousTurnId &&
      textEndMs(transcript) <= boundary.boundaryMs
    )
    .sort((left, right) => textEndMs(right) - textEndMs(left))[0];
  if (!previous) return rejected("missing_previous_final");
  const next = transcripts
    .filter((transcript) =>
      transcript.turnId === boundary.nextTurnId &&
      transcript.startMs >= boundary.boundaryMs
    )
    .sort((left, right) => left.startMs - right.startMs)[0];
  if (!next) return rejected("missing_next_final");
  if (
    !knownSpeaker(previous, boundary.previousSpeakerId) ||
    !knownSpeaker(next, boundary.nextSpeakerId) ||
    hasUnknownGapEvidence(transcripts, previous, next)
  ) return rejected("unknown_or_overlap");
  const previousGapMs = boundary.boundaryMs - textEndMs(previous);
  const nextGapMs = next.startMs - boundary.boundaryMs;
  if (previousGapMs > MAX_ENDPOINT_GAP_MS) {
    return rejected("previous_gap_exceeded");
  }
  if (nextGapMs > MAX_ENDPOINT_GAP_MS) {
    return rejected("next_gap_exceeded");
  }
  return {
    accepted: true,
    previousSegmentId: previous.segmentId,
    nextSegmentId: next.segmentId,
    previousGapMs,
    nextGapMs,
  };
}

function textEndMs(transcript: SpeakerEndpointTranscriptEvidence) {
  return transcript.lastTokenEndMs ?? transcript.endMs;
}

function knownSpeaker(
  transcript: SpeakerEndpointTranscriptEvidence,
  expectedSpeakerId: string,
) {
  return transcript.speakerKnown && !transcript.overlap &&
    transcript.speakerId === expectedSpeakerId;
}

function hasUnknownGapEvidence(
  transcripts: SpeakerEndpointTranscriptEvidence[],
  previous: SpeakerEndpointTranscriptEvidence,
  next: SpeakerEndpointTranscriptEvidence,
) {
  return transcripts.some((transcript) =>
    transcript !== previous && transcript !== next &&
    (!transcript.speakerKnown || transcript.overlap) &&
    transcript.endMs > previous.endMs &&
    transcript.startMs < next.startMs
  );
}

function rejected(
  reason: SpeakerEndpointNoopRejectionReason,
): SpeakerEndpointNoopDecision {
  return { accepted: false, reason };
}

function lastTokenEnd(transcript: TranscriptResult) {
  const tokens = transcript.tokenTimings ?? [];
  return tokens.length === 0
    ? {}
    : { lastTokenEndMs: Math.max(...tokens.map((token) => token.endMs)) };
}
