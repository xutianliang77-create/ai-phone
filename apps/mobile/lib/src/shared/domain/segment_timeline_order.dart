import 'speaker_attribution.dart';

List<T> orderTimelineByTiming<T>(
  Iterable<T> values, {
  required SegmentTiming? Function(T value) timingOf,
}) {
  final ordered = values.toList();
  if (ordered.length < 2 || ordered.any((value) => _unsafe(timingOf(value)))) {
    return ordered;
  }
  final indexes = List<int>.generate(ordered.length, (index) => index);
  indexes.sort((left, right) {
    final comparison = timingOf(ordered[left])!
        .startMs
        .compareTo(timingOf(ordered[right])!.startMs);
    return comparison != 0 ? comparison : left.compareTo(right);
  });
  return indexes.map((index) => ordered[index]).toList();
}

bool _unsafe(SegmentTiming? timing) {
  return timing == null ||
      timing.startMs < 0 ||
      timing.endMs < timing.startMs ||
      timing.overlap ||
      timing.activeSpeakerIds.length > 1;
}
