class AudioFrame {
  const AudioFrame({
    required this.sequence,
    required this.timestampMs,
    required this.sampleRate,
    required this.bytes,
  });

  final int sequence;
  final int timestampMs;
  final int sampleRate;
  final List<int> bytes;
}
