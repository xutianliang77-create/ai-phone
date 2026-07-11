import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';

void main() {
  test('parses realtime audio output payload', () {
    final event = GatewayRealtimeEvent.fromJson(const <String, Object?>{
      'type': 'audio.output',
      'sessionId': 'sess_1',
      'segmentId': 'seg_1',
      'format': 'pcm16',
      'sampleRate': 24000,
      'sequence': 1,
      'data': 'AA==',
    });

    expect(event.type, 'audio.output');
    expect(event.sessionId, 'sess_1');
    expect(event.segmentId, 'seg_1');
    expect(event.format, 'pcm16');
    expect(event.sampleRate, 24000);
    expect(event.sequence, 1);
    expect(event.data, 'AA==');
  });
}
