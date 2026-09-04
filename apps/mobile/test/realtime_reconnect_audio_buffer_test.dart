import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_reconnect_audio_buffer.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';

void main() {
  test('keeps the newest 2400 milliseconds and reports older audio loss', () {
    final buffer = RealtimeReconnectAudioBuffer();

    for (var sequence = 1; sequence <= 40; sequence += 1) {
      buffer.add(frame(sequence));
    }
    final drain = buffer.drain();

    expect(drain.frames.map((frame) => frame.sequence),
        List<int>.generate(24, (index) => index + 17));
    expect(drain.replayedAudioMs, 2400);
    expect(drain.droppedAudioMs, 1600);
    expect(buffer.drain(), same(RealtimeReconnectAudioDrain.empty));
  });

  test('clear removes buffered and dropped diagnostics', () {
    final buffer = RealtimeReconnectAudioBuffer(maxDurationMs: 200);
    buffer
      ..add(frame(1))
      ..add(frame(2))
      ..add(frame(3))
      ..clear();

    final drain = buffer.drain();

    expect(drain.frames, isEmpty);
    expect(drain.replayedAudioMs, 0);
    expect(drain.droppedAudioMs, 0);
  });
}

AudioFrame frame(int sequence) {
  return AudioFrame(
    sequence: sequence,
    timestampMs: sequence * 100,
    sampleRate: 24000,
    bytes: List<int>.filled(4800, 0),
  );
}
