import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_tts_capture_gate.dart';

void main() {
  test('queues TTS playback windows and keeps a final echo cooldown', () {
    var now = DateTime.fromMillisecondsSinceEpoch(1000);
    final gate = CallRoomTtsCaptureGate(now: () => now);

    expect(gate.blockFor(const Duration(seconds: 2)),
        const Duration(milliseconds: 2500));
    expect(gate.blockFor(const Duration(seconds: 1)),
        const Duration(milliseconds: 3500));

    now = now.add(const Duration(milliseconds: 3200));
    expect(gate.remaining, const Duration(milliseconds: 300));
    now = now.add(const Duration(milliseconds: 301));
    expect(gate.remaining, Duration.zero);
  });
}
