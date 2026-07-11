export function evaluateSpeakerDiarization(input) {
  const frameMs = positiveInteger(input.frameMs, 20);
  const durationMs = positiveInteger(
    input.durationMs,
    inferredDuration(input.reference, input.predicted),
  );
  const referenceSpeakers = uniqueSpeakers(input.reference);
  const predictedSpeakers = uniqueSpeakers(input.predicted);
  const mapping = bestSpeakerMapping({
    durationMs,
    frameMs,
    reference: input.reference,
    predicted: input.predicted,
    referenceSpeakers,
    predictedSpeakers,
  });
  const counts = scoreFrames({ ...input, durationMs, frameMs, mapping });
  const denominator = Math.max(1, counts.referenceSpeakerFrames);
  return {
    durationMs,
    frameMs,
    mapping,
    missedSpeechRate: counts.missed / denominator,
    falseAlarmRate: counts.falseAlarm / denominator,
    speakerConfusionRate: counts.confusion / denominator,
    diarizationErrorRate:
      (counts.missed + counts.falseAlarm + counts.confusion) / denominator,
    ...counts,
  };
}

function bestSpeakerMapping(input) {
  if (input.predictedSpeakers.length === 0) return {};
  const candidates = [
    ...input.referenceSpeakers,
    ...input.predictedSpeakers.map((_, index) => `__unmatched_${index}`),
  ];
  let best = { mapping: {}, overlap: -1 };
  for (const assignment of assignments(candidates, input.predictedSpeakers.length)) {
    const mapping = Object.fromEntries(
      input.predictedSpeakers.map((speaker, index) => [speaker, assignment[index]]),
    );
    const overlap = mappedOverlap({ ...input, mapping });
    if (overlap > best.overlap) best = { mapping, overlap };
  }
  return best.mapping;
}

function scoreFrames(input) {
  const counts = {
    referenceSpeakerFrames: 0,
    missed: 0,
    falseAlarm: 0,
    confusion: 0,
  };
  for (let at = 0; at < input.durationMs; at += input.frameMs) {
    const reference = activeSpeakers(input.reference, at);
    const predicted = new Set(
      [...activeSpeakers(input.predicted, at)].map(
        (speaker) => input.mapping[speaker] ?? speaker,
      ),
    );
    counts.referenceSpeakerFrames += reference.size;
    const missing = differenceSize(reference, predicted);
    const extra = differenceSize(predicted, reference);
    const confusion = Math.min(missing, extra);
    counts.confusion += confusion;
    counts.missed += missing - confusion;
    counts.falseAlarm += extra - confusion;
  }
  return counts;
}

function mappedOverlap(input) {
  let overlap = 0;
  for (let at = 0; at < input.durationMs; at += input.frameMs) {
    const reference = activeSpeakers(input.reference, at);
    for (const predicted of activeSpeakers(input.predicted, at)) {
      if (reference.has(input.mapping[predicted])) overlap += 1;
    }
  }
  return overlap;
}

function activeSpeakers(spans, atMs) {
  return new Set(
    spans
      .filter((span) => span.startMs <= atMs && span.endMs > atMs)
      .map((span) => span.speakerId),
  );
}

function assignments(values, length, prefix = []) {
  if (prefix.length === length) return [prefix];
  return values.flatMap((value, index) =>
    assignments(
      [...values.slice(0, index), ...values.slice(index + 1)],
      length,
      [...prefix, value],
    ),
  );
}

function differenceSize(left, right) {
  return [...left].filter((value) => !right.has(value)).length;
}

function uniqueSpeakers(spans) {
  return [...new Set(spans.map((span) => span.speakerId))].sort();
}

function inferredDuration(...groups) {
  return Math.max(1, ...groups.flat().map((span) => span.endMs));
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
