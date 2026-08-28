import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_reconnect_backoff.dart';

void main() {
  test('uses bounded exponential reconnect delays', () {
    const backoff = RealtimeReconnectBackoff(jitterRatio: 0);

    expect(
      [
        for (var attempt = 1; attempt <= 6; attempt += 1)
          backoff.delayForAttempt(attempt, jitterUnit: 0.5)
      ],
      const [
        Duration(seconds: 1),
        Duration(seconds: 2),
        Duration(seconds: 4),
        Duration(seconds: 8),
        Duration(seconds: 16),
        Duration(seconds: 16),
      ],
    );
  });

  test('applies deterministic jitter without exceeding the hard cap', () {
    const backoff = RealtimeReconnectBackoff();

    expect(
      backoff.delayForAttempt(1, jitterUnit: 0),
      const Duration(milliseconds: 800),
    );
    expect(
      backoff.delayForAttempt(1, jitterUnit: 1),
      const Duration(milliseconds: 1200),
    );
    expect(
      backoff.delayForAttempt(5, jitterUnit: 1),
      const Duration(seconds: 16),
    );
  });

  test('defines a stable period before reconnect attempts may reset', () {
    const backoff = RealtimeReconnectBackoff();

    expect(backoff.maxAttempts, 5);
    expect(backoff.stableConnectionPeriod, const Duration(seconds: 30));
    expect(
      () => backoff.delayForAttempt(0, jitterUnit: 0.5),
      throwsArgumentError,
    );
  });
}
