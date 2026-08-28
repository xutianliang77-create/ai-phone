class RealtimeReconnectBackoff {
  const RealtimeReconnectBackoff({
    this.maxAttempts = 5,
    this.initialDelay = const Duration(seconds: 1),
    this.maxDelay = const Duration(seconds: 16),
    this.jitterRatio = 0.2,
    this.stableConnectionPeriod = const Duration(seconds: 30),
  });

  final int maxAttempts;
  final Duration initialDelay;
  final Duration maxDelay;
  final double jitterRatio;
  final Duration stableConnectionPeriod;

  Duration delayForAttempt(
    int attempt, {
    required double jitterUnit,
  }) {
    if (attempt < 1) {
      throw ArgumentError.value(attempt, 'attempt', 'must be positive');
    }
    var baseMilliseconds = initialDelay.inMilliseconds;
    for (var index = 1; index < attempt; index += 1) {
      baseMilliseconds =
          (baseMilliseconds * 2).clamp(0, maxDelay.inMilliseconds).toInt();
    }
    final normalizedJitter = jitterUnit.clamp(0.0, 1.0);
    final jitterMultiplier =
        1 + (((normalizedJitter * 2) - 1) * jitterRatio.clamp(0.0, 1.0));
    final delayedMilliseconds = (baseMilliseconds * jitterMultiplier)
        .round()
        .clamp(0, maxDelay.inMilliseconds)
        .toInt();
    return Duration(milliseconds: delayedMilliseconds);
  }
}
