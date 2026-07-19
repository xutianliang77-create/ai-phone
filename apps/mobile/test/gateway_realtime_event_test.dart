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

  test('parses speaker attribution and shared timing', () {
    final event = GatewayRealtimeEvent.fromJson(const <String, Object?>{
      'type': 'transcript.final',
      'sessionId': 'sess_1',
      'segmentId': 'seg_1',
      'turnId': 'turn_4',
      'revision': 2,
      'text': '你好',
      'language': 'zh',
      'dominantLanguage': 'zh',
      'detectedLanguages': <String>['zh', 'en'],
      'mixedLanguage': true,
      'speaker': <String, Object?>{
        'speakerId': 'speaker_2',
        'role': 'speaker',
        'source': 'diarization',
        'confidence': 0.91,
      },
      'timing': <String, Object?>{
        'startMs': 1000,
        'endMs': 1800,
        'source': 'client',
        'overlap': true,
        'activeSpeakerIds': <String>['speaker_1', 'speaker_2'],
      },
      'vadContext': <String, Object?>{
        'endpointReason': 'speaker_boundary',
        'vadModelFingerprint': 'aaaaaaaa',
        'endpointPolicyFingerprint': 'bbbbbbbb',
      },
    });

    expect(event.speaker?.speakerId, 'speaker_2');
    expect(event.turnId, 'turn_4');
    expect(event.revision, 2);
    expect(event.speaker?.label(isChinese: true), '说话人 2');
    expect(event.timing?.startMs, 1000);
    expect(event.timing?.overlap, isTrue);
    expect(event.timing?.activeSpeakerIds, ['speaker_1', 'speaker_2']);
    expect(event.languageProfile?.dominantLanguage, 'zh');
    expect(event.languageProfile?.detectedLanguages, ['zh', 'en']);
    expect(event.languageProfile?.mixedLanguage, isTrue);
    expect(event.vadContext?['endpointReason'], 'speaker_boundary');
  });
}
