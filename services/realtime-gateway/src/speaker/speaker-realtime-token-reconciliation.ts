import type { TranscriptResult } from "../asr/asr-provider.js";
import type { SpeakerSpan } from "./speaker-attribution-provider.js";
import {
  splitTranscriptAtSpeakerBoundaries,
  type ConfirmedSpeakerBoundary,
  type SpeakerTokenSplitRejectionReason,
} from "./speaker-token-boundary-split.js";
import { crossesBoundary } from "./speaker-transcript-attribution.js";

export interface RealtimeTokenSplitSkip {
  segmentId: string;
  boundaryMs: number[];
  reason: SpeakerTokenSplitRejectionReason;
}

export interface RealtimeTokenBoundaryReconciliation {
  transcripts: TranscriptResult[];
  splitSegmentIds: string[];
  resolvedBoundaryMs: number[];
  skippedParents: RealtimeTokenSplitSkip[];
}

export function reconcileRealtimeSpeakerTokenBoundaries(input: {
  transcripts: TranscriptResult[];
  boundaries: ConfirmedSpeakerBoundary[];
  spans: SpeakerSpan[];
  isConfirmedSpeakerId: (speakerId: string) => boolean;
  protectedTerms?: string[];
}): RealtimeTokenBoundaryReconciliation {
  const transcripts: TranscriptResult[] = [];
  const splitSegmentIds = new Set<string>();
  const resolvedBoundaryMs = new Set<number>();
  const skippedParents: RealtimeTokenSplitSkip[] = [];

  for (const transcript of input.transcripts) {
    if (transcript.isFinal === false) {
      transcripts.push(transcript);
      continue;
    }
    const crossed = input.boundaries.filter((boundary) =>
      crossesBoundary(transcript, boundary.boundaryMs)
    );
    if (crossed.length === 0) {
      transcripts.push(transcript);
      continue;
    }
    const split = splitTranscriptAtSpeakerBoundaries(
      transcript,
      crossed,
      input.spans,
      input.isConfirmedSpeakerId,
      input.protectedTerms,
    );
    if (!split.accepted) {
      transcripts.push(transcript);
      skippedParents.push({
        segmentId: transcript.segmentId,
        boundaryMs: crossed.map((boundary) => boundary.boundaryMs),
        reason: split.reason,
      });
      continue;
    }
    transcripts.push(...split.transcripts);
    for (const child of split.transcripts) {
      splitSegmentIds.add(child.segmentId);
    }
    for (const boundary of crossed) {
      resolvedBoundaryMs.add(boundary.boundaryMs);
    }
  }

  return {
    transcripts,
    splitSegmentIds: [...splitSegmentIds],
    resolvedBoundaryMs: [...resolvedBoundaryMs],
    skippedParents,
  };
}
