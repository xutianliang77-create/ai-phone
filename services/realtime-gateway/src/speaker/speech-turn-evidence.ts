import type { SpeakerSpan } from "./speaker-attribution-provider.js";

export interface TailEvidence {
  speakerId: string;
  startMs: number;
  endMs: number;
  evidenceMs: number;
  confidence: number;
  dominanceRatio: number;
}

export type TailEvidenceResult =
  | { evidence: TailEvidence; rejectionReason?: never }
  | {
    evidence?: never;
    rejectionReason: "no_span" | "overlap_only" | "missing_confidence";
  };

export function dominantTailEvidence(
  spans: SpeakerSpan[],
  tailToleranceMs: number,
): TailEvidenceResult {
  const timed = spans.filter((span) => span.endMs > span.startMs);
  if (timed.length === 0) return { rejectionReason: "no_span" };

  const nonOverlap = timed.filter((span) => span.overlap !== true);
  if (nonOverlap.length === 0) return { rejectionReason: "overlap_only" };

  const usable = nonOverlap.filter((span) =>
    typeof span.confidence === "number"
  );
  if (usable.length === 0) return { rejectionReason: "missing_confidence" };

  const latestEndMs = usable.reduce(
    (latest, span) => Math.max(latest, span.endMs),
    0,
  );
  if (latestEndMs === 0) return { rejectionReason: "no_span" };
  const candidates = [...new Set(
    usable
      .filter((span) => latestEndMs - span.endMs <= tailToleranceMs)
      .map((span) => span.speakerId),
  )].map((speakerId) => speakerTailEvidence(
    speakerId,
    latestEndMs,
    usable,
    tailToleranceMs,
  )).filter((item): item is TailEvidence => item !== null);

  const evidence = candidates.sort((left, right) =>
    right.evidenceMs - left.evidenceMs ||
    right.confidence - left.confidence
  )[0];
  return evidence ? { evidence } : { rejectionReason: "no_span" };
}

function speakerTailEvidence(
  speakerId: string,
  latestEndMs: number,
  spans: SpeakerSpan[],
  tailToleranceMs: number,
): TailEvidence | null {
  const intervals = mergeIntervals(
    spans
      .filter((span) => span.speakerId === speakerId)
      .map((span) => ({ startMs: span.startMs, endMs: span.endMs })),
    tailToleranceMs,
  );
  const tail = [...intervals].reverse().find(
    (interval) => latestEndMs - interval.endMs <= tailToleranceMs,
  );
  if (!tail) return null;

  const evidenceMs = overlapForSpeaker(spans, speakerId, tail.startMs, tail.endMs);
  const totalEvidenceMs = [...new Set(spans.map((span) => span.speakerId))]
    .reduce(
      (total, id) => total + overlapForSpeaker(spans, id, tail.startMs, tail.endMs),
      0,
    );
  const confidence = weightedConfidence(
    spans.filter((span) => span.speakerId === speakerId),
    tail.startMs,
    tail.endMs,
  );
  if (confidence === null) return null;
  return {
    speakerId,
    startMs: tail.startMs,
    endMs: tail.endMs,
    evidenceMs,
    confidence,
    dominanceRatio: evidenceMs / Math.max(1, totalEvidenceMs),
  };
}

function overlapForSpeaker(
  spans: SpeakerSpan[],
  speakerId: string,
  startMs: number,
  endMs: number,
) {
  return mergeIntervals(
    spans
      .filter((span) => span.speakerId === speakerId)
      .map((span) => ({
        startMs: Math.max(startMs, span.startMs),
        endMs: Math.min(endMs, span.endMs),
      }))
      .filter((interval) => interval.endMs > interval.startMs),
    0,
  ).reduce((total, interval) => total + interval.endMs - interval.startMs, 0);
}

function weightedConfidence(
  spans: SpeakerSpan[],
  startMs: number,
  endMs: number,
) {
  const evidence = spans.flatMap((span) => {
    if (typeof span.confidence !== "number") return [];
    const weight = Math.max(
      0,
      Math.min(endMs, span.endMs) - Math.max(startMs, span.startMs),
    );
    return weight > 0 ? [{ value: span.confidence, weight }] : [];
  });
  const weight = evidence.reduce((total, item) => total + item.weight, 0);
  if (weight === 0) return null;
  return evidence.reduce(
    (total, item) => total + item.value * item.weight,
    0,
  ) / weight;
}

function mergeIntervals(
  intervals: Array<{ startMs: number; endMs: number }>,
  gapToleranceMs: number,
) {
  const sorted = [...intervals].sort((left, right) =>
    left.startMs - right.startMs || left.endMs - right.endMs
  );
  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.startMs > previous.endMs + gapToleranceMs) {
      merged.push({ ...interval });
    } else {
      previous.endMs = Math.max(previous.endMs, interval.endMs);
    }
  }
  return merged;
}
