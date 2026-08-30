import type { SessionSegmentDto } from "@translation/contracts";

export function orderSessionSegmentsChronologically(
  segments: readonly SessionSegmentDto[],
) {
  const ordered = [...segments];
  if (ordered.length < 2 || ordered.some(hasUnsafeTiming)) return ordered;
  return ordered
    .map((segment, index) => ({ segment, index }))
    .sort((left, right) =>
      left.segment.timing!.startMs - right.segment.timing!.startMs ||
      left.index - right.index
    )
    .map(({ segment }) => segment);
}

function hasUnsafeTiming(segment: SessionSegmentDto) {
  const timing = segment.timing;
  return !timing ||
    !Number.isSafeInteger(timing.startMs) ||
    !Number.isSafeInteger(timing.endMs) ||
    timing.startMs < 0 ||
    timing.endMs < timing.startMs ||
    timing.overlap === true ||
    (timing.activeSpeakerIds?.length ?? 0) > 1;
}
