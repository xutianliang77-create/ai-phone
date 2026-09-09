class AudioFrame {
  const AudioFrame({
    required this.sequence,
    required this.timestampMs,
    required this.sampleRate,
    required this.bytes,
    this.endsSegment = false,
  });

  final int sequence;
  final int timestampMs;
  final int sampleRate;
  final List<int> bytes;
  // Local endpoint metadata. The original PCM payload remains unchanged.
  final bool endsSegment;
}
