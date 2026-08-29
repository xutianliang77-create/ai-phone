import type { SpeakerSpan } from "./speaker-attribution-provider.js";
import type { SpeakerBoundaryGuard } from
  "./speaker-transcript-attribution.js";

const retentionMs = 120_000;

export function retainRecentSpeakerSpans(
  existing: SpeakerSpan[],
  next: SpeakerSpan[],
) {
  const indexed = new Map<string, SpeakerSpan>();
  for (const span of [...existing, ...next]) {
    indexed.set(`${span.speakerId}:${span.startMs}`, span);
  }
  const spans = [...indexed.values()];
  const newestEndMs = spans.reduce(
    (latest, span) => Math.max(latest, span.endMs),
    0,
  );
  const cutoffMs = newestEndMs - retentionMs;
  return spans.filter((span) => span.endMs >= cutoffMs);
}

export function retainRecentSpeakerBoundaries(
  existing: SpeakerBoundaryGuard[],
  boundary: SpeakerBoundaryGuard,
) {
  const cutoffMs = boundary.boundaryMs - retentionMs;
  return [...existing, boundary].filter((item) =>
    item.boundaryMs >= cutoffMs
  );
}
