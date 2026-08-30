import type {
  SegmentTimingDto,
  SpeakerAttributionDto,
  SpeakerUpdatedEvent,
} from "@translation/contracts";
import type {
  SpeakerRevisionResult,
  SpeakerRevisionSpan,
} from "./speaker-revision-provider.js";
import {
  absoluteRevisionSpans,
  intersection,
  mapRevisionLabels,
  validateSpeakerRevision,
} from "./speaker-revision-evidence.js";

export interface RevisableSpeakerSegment {
  sessionId: string;
  segmentId: string;
  turnId?: string;
  revision?: number;
  speakerRevision?: number;
  speaker?: SpeakerAttributionDto;
  timing?: SegmentTimingDto;
}

export interface SpeakerRevisionReconcileResult {
  accepted: boolean;
  reason?: string;
  updates: SpeakerUpdatedEvent[];
  labelMapping: Record<string, string>;
}

const MIN_COVERAGE = 0.50;
const DOMINANT_SHARE = 0.80;
const SECONDARY_SHARE = 0.20;
const MIN_OVERLAP_EVIDENCE_MS = 160;

export function reconcileSpeakerRevision(
  revision: SpeakerRevisionResult,
  segments: RevisableSpeakerSegment[],
): SpeakerRevisionReconcileResult {
  const validation = validateSpeakerRevision(revision);
  if (validation) return rejected(validation);
  if (segments.some((segment) => segment.sessionId !== revision.sessionId)) {
    return rejected("session_mismatch");
  }
  const eligible = segments.filter((segment) => segment.timing);
  if (eligible.length === 0) return rejected("no_timed_segments");

  const spans = absoluteRevisionSpans(revision);
  const labelMapping = mapRevisionLabels(spans, eligible);
  const updates = eligible.flatMap((segment) =>
    updateForSegment(segment, spans, labelMapping)
  );
  return { accepted: true, updates, labelMapping };
}

function updateForSegment(
  segment: RevisableSpeakerSegment,
  spans: SpeakerRevisionSpan[],
  labelMapping: Record<string, string>,
): SpeakerUpdatedEvent[] {
  const timing = segment.timing!;
  if (timing.overlap === true) return [];
  const durationMs = Math.max(1, timing.endMs - timing.startMs);
  const intersections = spans.flatMap((span) => {
    const duration = intersection(
      timing.startMs,
      timing.endMs,
      span.startMs,
      span.endMs,
    );
    return duration > 0 ? [{ span, duration }] : [];
  });
  const coverage = unionDuration(intersections.map(({ span }) => ({
    startMs: Math.max(timing.startMs, span.startMs),
    endMs: Math.min(timing.endMs, span.endMs),
  }))) / durationMs;
  if (coverage < MIN_COVERAGE) return [];

  const bySpeaker = new Map<string, number>();
  for (const { span, duration } of intersections) {
    const speakerId = labelMapping[span.speakerId];
    bySpeaker.set(speakerId, (bySpeaker.get(speakerId) ?? 0) + duration);
  }
  const totalEvidenceMs = [...bySpeaker.values()].reduce(
    (total, value) => total + value,
    0,
  );
  const ranked = [...bySpeaker.entries()]
    .map(([speakerId, duration]) => ({
      speakerId,
      share: duration / Math.max(1, totalEvidenceMs),
    }))
    .sort((left, right) => right.share - left.share);
  const dominant = ranked[0];
  if (!dominant) return [];
  const meaningful = ranked.filter((item) => item.share >= SECONDARY_SHARE);
  const overlapIds = explicitOverlapIds(intersections, labelMapping);
  const crossesBoundary = meaningful.length > 1 && overlapIds.length < 2;
  const revisedSpeaker = crossesBoundary || dominant.share < DOMINANT_SHARE
    ? unknownSpeaker()
    : diarizedSpeaker(dominant.speakerId);
  const hasExplicitOverlap = overlapIds.length >= 2;
  const activeSpeakerIds = hasExplicitOverlap
    ? overlapIds
    : crossesBoundary
      ? meaningful.map((item) => item.speakerId).sort()
      : [];
  const revisedTiming = {
    ...timing,
    overlap: hasExplicitOverlap,
    activeSpeakerIds,
  };
  if (
    sameSpeaker(segment.speaker, revisedSpeaker) &&
    sameTiming(timing, revisedTiming)
  ) return [];
  return [{
    type: "speaker.updated",
    sessionId: segment.sessionId,
    segmentId: segment.segmentId,
    turnId: segment.turnId,
    revision: segment.revision,
    speakerRevision: (segment.speakerRevision ?? 0) + 1,
    speaker: revisedSpeaker,
    timing: revisedTiming,
  }];
}

function explicitOverlapIds(
  intersections: Array<{ span: SpeakerRevisionSpan; duration: number }>,
  labelMapping: Record<string, string>,
) {
  return [...new Set(intersections
    .filter(({ span, duration }) =>
      span.overlap === true && duration >= MIN_OVERLAP_EVIDENCE_MS
    )
    .map(({ span }) => labelMapping[span.speakerId]))]
    .sort();
}

function unionDuration(intervals: Array<{ startMs: number; endMs: number }>) {
  const sorted = intervals.sort((left, right) => left.startMs - right.startMs);
  let total = 0;
  let start: number | undefined;
  let end: number | undefined;
  for (const interval of sorted) {
    if (start === undefined || end === undefined) {
      ({ startMs: start, endMs: end } = interval);
    } else if (interval.startMs <= end) {
      end = Math.max(end, interval.endMs);
    } else {
      total += end - start;
      ({ startMs: start, endMs: end } = interval);
    }
  }
  return start === undefined || end === undefined ? total : total + end - start;
}

function diarizedSpeaker(speakerId: string): SpeakerAttributionDto {
  return { speakerId, role: "speaker", source: "diarization" };
}

function unknownSpeaker(): SpeakerAttributionDto {
  return { speakerId: "unknown", role: "unknown", source: "unknown" };
}

function sameSpeaker(
  left: SpeakerAttributionDto | undefined,
  right: SpeakerAttributionDto,
) {
  return left?.speakerId === right.speakerId && left.role === right.role;
}

function sameTiming(left: SegmentTimingDto, right: SegmentTimingDto) {
  return (left.overlap ?? false) === (right.overlap ?? false) &&
    JSON.stringify(left.activeSpeakerIds ?? []) ===
      JSON.stringify(right.activeSpeakerIds ?? []);
}

function rejected(reason: string): SpeakerRevisionReconcileResult {
  return { accepted: false, reason, updates: [], labelMapping: {} };
}
