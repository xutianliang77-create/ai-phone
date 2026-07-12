import type {
  SegmentTimingDto,
  SpeakerAttributionDto,
} from "@translation/contracts";
import type { SpeakerSpan } from "./speaker-attribution-provider.js";

export interface SpeakerAlignment {
  speaker: SpeakerAttributionDto;
  timing: SegmentTimingDto;
}

export function alignSpeakerSpan(
  timing: SegmentTimingDto | undefined,
  spans: SpeakerSpan[],
  minimumEvidenceMs = 160,
  minimumDominanceRatio = 0.55,
): SpeakerAlignment | null {
  if (!timing || spans.length === 0) return null;
  const ranked = aggregateBySpeaker(timing, spans)
    .sort((left, right) => right.overlapMs - left.overlapMs);
  const best = ranked[0];
  const totalEvidenceMs = ranked.reduce(
    (total, evidence) => total + evidence.overlapMs,
    0,
  );
  const activeSpeakerIds = ranked
    .filter((evidence) => evidence.overlap)
    .map((evidence) => evidence.speakerId);
  if (
    !best ||
    best.overlapMs < minimumEvidenceMs ||
    best.overlapMs / Math.max(1, totalEvidenceMs) < minimumDominanceRatio
  ) return unknownAlignment(timing, activeSpeakerIds);
  return {
    speaker: {
      speakerId: best.speakerId,
      role: "speaker",
      source: "diarization",
      ...(typeof best.confidence === "number"
        ? { confidence: best.confidence }
        : {}),
    },
    timing: {
      ...timing,
      ...(best.overlap ? { overlap: true } : {}),
      ...(activeSpeakerIds.length > 0 ? { activeSpeakerIds } : {}),
    },
  };
}

function unknownAlignment(
  timing: SegmentTimingDto,
  activeSpeakerIds: string[],
): SpeakerAlignment {
  return {
    speaker: {
      speakerId: "unknown",
      role: "unknown",
      source: "unknown",
    },
    timing: {
      ...timing,
      ...(activeSpeakerIds.length > 0
        ? { overlap: true, activeSpeakerIds }
        : {}),
    },
  };
}

interface SpeakerEvidence {
  speakerId: string;
  overlapMs: number;
  confidence?: number;
  overlap: boolean;
}

function aggregateBySpeaker(
  timing: SegmentTimingDto,
  spans: SpeakerSpan[],
): SpeakerEvidence[] {
  const grouped = new Map<string, SpeakerSpan[]>();
  for (const span of spans) {
    if (overlapMs(timing, span) === 0) continue;
    grouped.set(span.speakerId, [...(grouped.get(span.speakerId) ?? []), span]);
  }
  return [...grouped.entries()].map(([speakerId, speakerSpans]) => {
    const intervals = speakerSpans
      .map((span) => ({
        startMs: Math.max(timing.startMs, span.startMs),
        endMs: Math.min(timing.endMs, span.endMs),
      }))
      .sort((left, right) => left.startMs - right.startMs);
    const overlapMs = unionDuration(intervals);
    const confidenceEvidence = speakerSpans
      .filter((span) => typeof span.confidence === "number")
      .map((span) => ({
        value: span.confidence as number,
        weight: Math.max(1, Math.min(timing.endMs, span.endMs) - Math.max(timing.startMs, span.startMs)),
      }));
    const confidenceWeight = confidenceEvidence.reduce(
      (total, item) => total + item.weight,
      0,
    );
    return {
      speakerId,
      overlapMs,
      ...(confidenceWeight > 0
        ? {
            confidence: confidenceEvidence.reduce(
              (total, item) => total + item.value * item.weight,
              0,
            ) / confidenceWeight,
          }
        : {}),
      overlap: speakerSpans.some((span) => span.overlap === true),
    };
  });
}

function unionDuration(intervals: Array<{ startMs: number; endMs: number }>) {
  let total = 0;
  let currentStart: number | null = null;
  let currentEnd = 0;
  for (const interval of intervals) {
    if (currentStart === null) {
      currentStart = interval.startMs;
      currentEnd = interval.endMs;
    } else if (interval.startMs <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.endMs);
    } else {
      total += currentEnd - currentStart;
      currentStart = interval.startMs;
      currentEnd = interval.endMs;
    }
  }
  return currentStart === null ? 0 : total + currentEnd - currentStart;
}

function overlapMs(
  timing: SegmentTimingDto,
  span: SpeakerSpan,
) {
  return Math.max(
    0,
    Math.min(timing.endMs, span.endMs) - Math.max(timing.startMs, span.startMs),
  );
}
