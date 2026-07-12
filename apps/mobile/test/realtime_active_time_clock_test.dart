import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_active_time_clock.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';

void main() {
  test('counts active time while excluding paused and disconnected time', () {
    var now = DateTime.utc(2026, 7, 12);
    final clock = RealtimeActiveTimeClock(now: () => now);

    clock.transition(RealtimeStatus.connecting, RealtimeStatus.active);
    now = now.add(const Duration(milliseconds: 2100));
    clock.transition(RealtimeStatus.active, RealtimeStatus.paused);
    now = now.add(const Duration(seconds: 20));
    expect(clock.billableSeconds, 3);

    clock.transition(RealtimeStatus.paused, RealtimeStatus.active);
    now = now.add(const Duration(milliseconds: 1100));
    clock.transition(RealtimeStatus.active, RealtimeStatus.ended);
    expect(clock.billableSeconds, 4);
  });
}
