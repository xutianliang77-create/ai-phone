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
  minimumOverlapRatio = 0.35,
): SpeakerAlignment | null {
  if (!timing || spans.length === 0) return null;
  const duration = Math.max(1, timing.endMs - timing.startMs);
  const ranked = spans
    .map((span) => ({ span, overlapMs: overlapMs(timing, span) }))
    .sort((left, right) => right.overlapMs - left.overlapMs);
  const best = ranked[0];
  if (!best || best.overlapMs / duration < minimumOverlapRatio) return null;
  return {
    speaker: {
      speakerId: best.span.speakerId,
      role: "speaker",
      source: "diarization",
      ...(typeof best.span.confidence === "number"
        ? { confidence: best.span.confidence }
        : {}),
    },
    timing: {
      ...timing,
      ...(best.span.overlap ? { overlap: true } : {}),
    },
  };
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
