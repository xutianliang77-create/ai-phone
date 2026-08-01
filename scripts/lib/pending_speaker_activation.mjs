export function filterPendingSpeakerSpans(spans, minimumDurationOnMs) {
  if (!(minimumDurationOnMs > 0)) return [...spans];
  const retained = new Set();
  const indexed = spans.map((span, index) => ({ span, index }));
  const speakers = new Set(indexed.map((item) => item.span.speakerId));
  for (const speakerId of speakers) {
    const speakerSpans = indexed
      .filter((item) => item.span.speakerId === speakerId)
      .sort((left, right) => left.span.startMs - right.span.startMs);
    let run = [];
    let runStart = 0;
    let runEnd = 0;
    const retainRun = () => {
      if (runEnd - runStart < minimumDurationOnMs) return;
      for (const item of run) retained.add(item.index);
    };
    for (const item of speakerSpans) {
      if (run.length === 0 || item.span.startMs > runEnd) {
        retainRun();
        run = [item];
        runStart = item.span.startMs;
        runEnd = item.span.endMs;
      } else {
        run.push(item);
        runEnd = Math.max(runEnd, item.span.endMs);
      }
    }
    retainRun();
  }
  return indexed
    .filter((item) => retained.has(item.index))
    .map((item) => item.span);
}
