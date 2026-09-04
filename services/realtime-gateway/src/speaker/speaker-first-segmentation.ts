import type {
  SegmentTimingDto,
  SpeakerAttributionDto,
  SpeakerUpdatedEvent,
} from "@translation/contracts";
import type { TranscriptResult } from "../asr/asr-provider.js";
import {
  planHighContextTokenSplits,
  type HighContextSplitRejectionReason,
  type SkippedTokenSplitParent,
  type StoredTranscriptFinal,
} from "./speaker-high-context-token-split.js";
import type { SpeakerRevisionResult } from "./speaker-revision-provider.js";
import {
  reconcileSpeakerRevision,
} from "./speaker-revision-reconciler.js";

export type SpeakerFirstRejectionReason =
  | "single_speaker_collapse"
  | "speaker_count_growth"
  | "revision_rejected"
  | "canonical_cardinality_mismatch"
  | "output_cardinality_mismatch"
  | HighContextSplitRejectionReason;

export type SpeakerFirstSegmentationPlan =
  | {
      accepted: true;
      transcripts: TranscriptResult[];
      speakerUpdates: SpeakerUpdatedEvent[];
      parentSegmentIds: string[];
      skippedParents: SkippedTokenSplitParent[];
      speakerIdMapping: Record<string, string>;
    }
  | {
      accepted: false;
      reason: SpeakerFirstRejectionReason;
      transcripts: [];
      speakerUpdates: [];
      parentSegmentIds: [];
      skippedParents: [];
      speakerIdMapping: Record<string, string>;
    };

export type SpeakerFirstStoredTranscript = StoredTranscriptFinal & {
  speakerRevision?: number;
};

export function planSpeakerFirstSegmentation(
  revision: SpeakerRevisionResult,
  segments: SpeakerFirstStoredTranscript[],
  protectedTerms: string[] = [],
): SpeakerFirstSegmentationPlan {
  const rawSpeakerIds = speakerIds(segments);
  if (rawSpeakerIds.size > 1 && revision.speakerCount === 1) {
    return rejected("single_speaker_collapse");
  }
  if (revision.speakerCount > rawSpeakerIds.size) {
    return rejected("speaker_count_growth");
  }

  const reconciled = reconcileSpeakerRevision(revision, segments);
  if (!reconciled.accepted) return rejected("revision_rejected");
  const revisedSegments = applySpeakerUpdates(segments, reconciled.updates);
  const canonicalIds = new Set(Object.values(reconciled.labelMapping));
  if (canonicalIds.size !== revision.speakerCount) {
    return rejected("canonical_cardinality_mismatch");
  }

  const split = planHighContextTokenSplits(
    revision,
    revisedSegments,
    protectedTerms,
    reconciled.labelMapping,
  );
  if (
    !split.accepted &&
    split.reason !== "no_crossing_transcript" &&
    !(split.reason.startsWith("token_split_") && reconciled.updates.length > 0)
  ) {
    return rejected(split.reason);
  }

  const parentSegmentIds = split.accepted ? split.parentSegmentIds : [];
  const skippedParents = split.skippedParents;
  const parents = new Set(parentSegmentIds);
  const speakerIdMapping = contiguousSpeakerMapping(
    revision,
    reconciled.labelMapping,
  );
  for (const speakerId of speakerIds(revisedSegments)) {
    if (!speakerIdMapping[speakerId]) speakerIdMapping[speakerId] = "unknown";
  }
  const transcripts = split.accepted
    ? split.transcripts.map((item) => normalizeTranscript(
      item,
      speakerIdMapping,
    ))
    : [];
  const speakerUpdates = revisedSegments.flatMap((segment) => {
    if (parents.has(segment.segmentId)) return [];
    const normalizedSpeaker = normalizeSpeaker(
      segment.speaker,
      speakerIdMapping,
    );
    const normalizedTiming = normalizeTiming(
      segment.timing,
      speakerIdMapping,
    );
    const original = segments.find((item) =>
      item.segmentId === segment.segmentId
    );
    if (
      original &&
      sameSpeaker(original.speaker, normalizedSpeaker) &&
      sameTiming(original.timing, normalizedTiming)
    ) return [];
    return [{
      type: "speaker.updated" as const,
      sessionId: segment.sessionId,
      segmentId: segment.segmentId,
      turnId: segment.turnId,
      revision: segment.revision,
      speakerRevision: (segment.speakerRevision ?? 0) + 1,
      speaker: normalizedSpeaker ?? unknownSpeaker(),
      timing: normalizedTiming,
    }];
  });
  const updateBySegment = new Map(
    speakerUpdates.map((item) => [item.segmentId, item]),
  );
  const outputSpeakerIds = new Set([
    ...revisedSegments.filter((segment) => !parents.has(segment.segmentId))
      .flatMap((segment) => {
        const speaker = updateBySegment.get(segment.segmentId)?.speaker ??
          normalizeSpeaker(segment.speaker, speakerIdMapping);
        const speakerId = usableSpeakerId(speaker);
        return speakerId ? [speakerId] : [];
      }),
    ...transcripts.flatMap((transcript) => {
      const speakerId = usableSpeakerId(transcript.speaker);
      return speakerId ? [speakerId] : [];
    }),
  ]);
  if (outputSpeakerIds.size !== revision.speakerCount) {
    return rejected("output_cardinality_mismatch");
  }

  return {
    accepted: true,
    transcripts,
    speakerUpdates,
    parentSegmentIds,
    skippedParents,
    speakerIdMapping,
  };
}

function applySpeakerUpdates(
  segments: SpeakerFirstStoredTranscript[],
  updates: SpeakerUpdatedEvent[],
) {
  const indexed = new Map(updates.map((item) => [item.segmentId, item]));
  return segments.map((segment) => {
    const update = indexed.get(segment.segmentId);
    return update
      ? {
          ...segment,
          speakerRevision: update.speakerRevision,
          speaker: update.speaker,
          timing: update.timing ?? segment.timing,
        }
      : segment;
  });
}

function contiguousSpeakerMapping(
  revision: SpeakerRevisionResult,
  revisionLabels: Record<string, string>,
) {
  const mapping: Record<string, string> = {};
  for (const span of revision.spans) {
    const speakerId = revisionLabels[span.speakerId];
    if (!speakerId || mapping[speakerId]) continue;
    mapping[speakerId] = `speaker_${Object.keys(mapping).length + 1}`;
  }
  return mapping;
}

function normalizeTranscript(
  transcript: TranscriptResult,
  mapping: Record<string, string>,
) {
  return {
    ...transcript,
    speaker: normalizeSpeaker(transcript.speaker, mapping),
    timing: normalizeTiming(transcript.timing, mapping),
  };
}

function normalizeSpeaker(
  speaker: SpeakerAttributionDto | undefined,
  mapping: Record<string, string>,
) {
  const speakerId = usableSpeakerId(speaker);
  if (!speakerId) return speaker;
  const normalized = mapping[speakerId] ?? speakerId;
  return normalized === "unknown"
    ? unknownSpeaker()
    : { ...speaker!, speakerId: normalized };
}

function normalizeTiming(
  timing: SegmentTimingDto | undefined,
  mapping: Record<string, string>,
) {
  if (!timing?.activeSpeakerIds) return timing;
  const activeSpeakerIds = [...new Set(timing.activeSpeakerIds.map((speakerId) =>
    mapping[speakerId] ?? speakerId
  ))].filter((speakerId) => speakerId !== "unknown");
  return {
    ...timing,
    activeSpeakerIds,
  };
}

function speakerIds(segments: SpeakerFirstStoredTranscript[]) {
  return new Set(segments.flatMap((segment) => {
    const speakerId = usableSpeakerId(segment.speaker);
    return speakerId ? [speakerId] : [];
  }));
}

function usableSpeakerId(speaker: SpeakerAttributionDto | undefined) {
  const speakerId = speaker?.speakerId;
  return speakerId && speakerId !== "unknown" ? speakerId : null;
}

function sameSpeaker(
  left: SpeakerAttributionDto | undefined,
  right: SpeakerAttributionDto | undefined,
) {
  return left?.speakerId === right?.speakerId && left?.role === right?.role;
}

function sameTiming(
  left: SegmentTimingDto | undefined,
  right: SegmentTimingDto | undefined,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unknownSpeaker(): SpeakerAttributionDto {
  return { speakerId: "unknown", role: "unknown", source: "unknown" };
}

function rejected(
  reason: SpeakerFirstRejectionReason,
): SpeakerFirstSegmentationPlan {
  return {
    accepted: false,
    reason,
    transcripts: [],
    speakerUpdates: [],
    parentSegmentIds: [],
    skippedParents: [],
    speakerIdMapping: {},
  };
}
