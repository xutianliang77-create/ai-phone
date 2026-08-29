import type {
  SegmentTimingDto,
  SpeakerAttributionDto,
} from "@translation/contracts";
import type {
  SpeakerRevisionResult,
  SpeakerRevisionSpan,
} from "./speaker-revision-provider.js";

interface EvidenceSegment {
  speaker?: SpeakerAttributionDto;
  timing?: SegmentTimingDto;
}

const MAX_SPEAKERS = 8;
const MIN_MAPPING_EVIDENCE_MS = 500;
const TIMESTAMP_TOLERANCE_MS = 500;

export function validateSpeakerRevision(revision: SpeakerRevisionResult) {
  if (
    !Number.isInteger(revision.generation) ||
    revision.generation <= 0 ||
    !Number.isInteger(revision.speakerCount) ||
    revision.speakerCount <= 0 ||
    revision.speakerCount > MAX_SPEAKERS ||
    revision.windowEndMs <= revision.windowStartMs ||
    revision.spans.length === 0
  ) return "invalid_contract";

  const durationMs = revision.windowEndMs - revision.windowStartMs;
  let previousStartMs = -1;
  const labels = new Set<string>();
  for (const span of revision.spans) {
    if (
      !safeSpeakerId(span.speakerId) ||
      !finite(span.startMs) ||
      !finite(span.endMs) ||
      span.startMs < 0 ||
      span.endMs <= span.startMs ||
      span.endMs > durationMs + TIMESTAMP_TOLERANCE_MS ||
      span.startMs < previousStartMs ||
      !(span.confidence === undefined || ratio(span.confidence))
    ) return "invalid_span";
    previousStartMs = span.startMs;
    labels.add(span.speakerId);
  }
  return labels.size === revision.speakerCount
    ? null
    : "speaker_count_mismatch";
}

export function absoluteRevisionSpans(revision: SpeakerRevisionResult) {
  return revision.spans.map((span) => ({
    ...span,
    startMs: revision.windowStartMs + span.startMs,
    endMs: revision.windowStartMs + span.endMs,
  }));
}

export function mapRevisionLabels(
  spans: SpeakerRevisionSpan[],
  segments: EvidenceSegment[],
) {
  const labels = [...new Set(spans.map((span) => span.speakerId))];
  const existingSpeakers = [...new Set(segments.flatMap((segment) => {
    const speakerId = usableSpeakerId(segment.speaker);
    return speakerId ? [speakerId] : [];
  }))];
  const candidates = labels.flatMap((label) =>
    existingSpeakers.map((speakerId) => ({
      label,
      speakerId,
      evidenceMs: mappingEvidence(label, speakerId, spans, segments),
    })))
    .filter((candidate) => candidate.evidenceMs >= MIN_MAPPING_EVIDENCE_MS)
    .sort((left, right) => right.evidenceMs - left.evidenceMs);

  const mapping = new Map<string, string>();
  const usedSpeakers = new Set<string>();
  const anchor = firstSpeakerAnchor(spans, segments);
  if (anchor) {
    mapping.set(anchor.label, anchor.speakerId);
    usedSpeakers.add(anchor.speakerId);
  }
  for (const candidate of candidates) {
    if (mapping.has(candidate.label) || usedSpeakers.has(candidate.speakerId)) {
      continue;
    }
    mapping.set(candidate.label, candidate.speakerId);
    usedSpeakers.add(candidate.speakerId);
  }
  for (const label of labels) {
    if (mapping.has(label)) continue;
    const allocated = nextSpeakerId(new Set([
      ...existingSpeakers,
      ...usedSpeakers,
    ]));
    mapping.set(label, allocated);
    usedSpeakers.add(allocated);
  }
  return Object.fromEntries(mapping);
}

function firstSpeakerAnchor(
  spans: SpeakerRevisionSpan[],
  segments: EvidenceSegment[],
) {
  const firstSpan = spans[0];
  if (!firstSpan) return null;
  const candidates = segments.flatMap((segment) => {
    const speakerId = usableSpeakerId(segment.speaker);
    if (!speakerId || !segment.timing) return [];
    const evidenceMs = intersection(
      segment.timing.startMs,
      segment.timing.endMs,
      firstSpan.startMs,
      firstSpan.endMs,
    );
    return evidenceMs >= MIN_MAPPING_EVIDENCE_MS
      ? [{ label: firstSpan.speakerId, speakerId, evidenceMs }]
      : [];
  }).sort((left, right) => right.evidenceMs - left.evidenceMs);
  return candidates[0] ?? null;
}

function mappingEvidence(
  label: string,
  speakerId: string,
  spans: SpeakerRevisionSpan[],
  segments: EvidenceSegment[],
) {
  return segments
    .filter((segment) =>
      segment.timing && usableSpeakerId(segment.speaker) === speakerId
    )
    .reduce((total, segment) => total + spans
      .filter((span) => span.speakerId === label)
      .reduce((sum, span) => sum + intersection(
        segment.timing!.startMs,
        segment.timing!.endMs,
        span.startMs,
        span.endMs,
      ), 0), 0);
}

export function intersection(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function nextSpeakerId(used: Set<string>) {
  for (let index = 1; index <= MAX_SPEAKERS; index += 1) {
    const candidate = `speaker_${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return "unknown";
}

function usableSpeakerId(speaker: SpeakerAttributionDto | undefined) {
  const speakerId = speaker?.speakerId;
  return speakerId && speakerId !== "unknown" ? speakerId : null;
}

function safeSpeakerId(value: string) {
  return /^[A-Za-z0-9._-]{1,80}$/.test(value);
}

function finite(value: number) {
  return Number.isFinite(value);
}

function ratio(value: number) {
  return finite(value) && value >= 0 && value <= 1;
}
