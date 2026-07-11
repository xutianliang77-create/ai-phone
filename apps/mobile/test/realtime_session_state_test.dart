import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_session_state.dart';

void main() {
  test('supports the normal realtime lifecycle', () {
    final transitions = <(RealtimeStatus, RealtimeStatus)>[
      (RealtimeStatus.idle, RealtimeStatus.connecting),
      (RealtimeStatus.connecting, RealtimeStatus.active),
      (RealtimeStatus.active, RealtimeStatus.paused),
      (RealtimeStatus.paused, RealtimeStatus.active),
      (RealtimeStatus.active, RealtimeStatus.ending),
      (RealtimeStatus.ending, RealtimeStatus.ended),
    ];

    for (final (previous, requested) in transitions) {
      final result = transitionRealtimeStatus(previous, requested);
      expect(result.accepted, isTrue);
      expect(result.changed, isTrue);
      expect(result.current, requested);
    }
  });

  test('makes repeated transitions idempotent', () {
    final result = transitionRealtimeStatus(
      RealtimeStatus.paused,
      RealtimeStatus.paused,
    );

    expect(result.accepted, isTrue);
    expect(result.changed, isFalse);
  });

  test('rejects illegal transitions', () {
    final result = transitionRealtimeStatus(
      RealtimeStatus.ending,
      RealtimeStatus.paused,
    );

    expect(result.accepted, isFalse);
    expect(result.current, RealtimeStatus.ending);
  });
}
