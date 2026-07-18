import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_data_event.dart';

void main() {
  test('parses worker status data messages', () {
    final payload = parseCallRoomData(utf8.encode(jsonEncode({
      'type': 'worker.status',
      'callId': 'call_1',
      'roomName': 'call_call_1',
      'text': '房间翻译 Worker 已连接',
    })));

    expect(payload.message, '房间翻译 Worker 已连接');
    expect(payload.caption, isNull);
  });

  test('parses transcript final events as source captions', () {
    final payload = parseCallRoomData(utf8.encode(jsonEncode({
      'type': 'transcript.final',
      'callId': 'call_1',
      'roomName': 'call_call_1',
      'segmentId': 'segment-1',
      'speakerRole': 'guest',
      'sourceLanguage': 'en',
      'targetLanguage': 'zh',
      'text': 'hello',
      'timestampMs': 1,
    })));

    expect(payload.message, isNull);
    expect(payload.caption?.segmentId, 'segment-1');
    expect(payload.caption?.speakerRole, 'guest');
    expect(payload.caption?.sourceText, 'hello');
    expect(payload.caption?.translatedText, isNull);
  });

  test('parses translation final events as translated captions', () {
    final payload = parseCallRoomData(utf8.encode(jsonEncode({
      'type': 'translation.final',
      'callId': 'call_1',
      'roomName': 'call_call_1',
      'segmentId': 'segment-1',
      'speakerRole': 'guest',
      'sourceLanguage': 'en',
      'targetLanguage': 'zh',
      'sourceText': 'hello',
      'translatedText': '你好',
      'timestampMs': 2,
    })));

    expect(payload.caption?.segmentId, 'segment-1');
    expect(payload.caption?.sourceText, 'hello');
    expect(payload.caption?.translatedText, '你好');
  });

  test('parses tts ready events as caption voice metadata', () {
    final payload = parseCallRoomData(utf8.encode(jsonEncode({
      'type': 'tts.ready',
      'callId': 'call_1',
      'roomName': 'call_call_1',
      'segmentId': 'segment-1',
      'speakerRole': 'guest',
      'sourceLanguage': 'en',
      'targetLanguage': 'zh',
      'sourceText': 'hello',
      'translatedText': '你好',
      'provider': 'qwen-tts',
      'model': 'qwen3-tts-0.6b',
      'firstAudioMs': 320,
      'audioDurationMs': 1200,
      'timestampMs': 3,
    })));

    expect(payload.message, isNull);
    expect(payload.caption?.segmentId, 'segment-1');
    expect(payload.caption?.sourceText, 'hello');
    expect(payload.caption?.translatedText, '你好');
    expect(payload.caption?.ttsReady, isTrue);
    expect(payload.caption?.ttsProvider, 'qwen-tts');
    expect(payload.caption?.ttsModel, 'qwen3-tts-0.6b');
    expect(payload.caption?.firstAudioMs, 320);
    expect(payload.caption?.audioDurationMs, 1200);
  });

  test('parses full duplex degradation and recovery controls', () {
    final degraded = parseCallRoomData(utf8.encode(jsonEncode({
      'type': 'pipeline.degraded',
      'callId': 'call_1',
      'roomName': 'call_call_1',
      'duplexMode': 'half_duplex',
      'degradationReason': 'vad_fallback',
    })));
    final restored = parseCallRoomData(utf8.encode(jsonEncode({
      'type': 'pipeline.restored',
      'callId': 'call_1',
      'roomName': 'call_call_1',
      'duplexMode': 'full_duplex',
    })));

    expect(degraded.duplexMode, 'half_duplex');
    expect(degraded.degradationReason, 'vad_fallback');
    expect(degraded.message, '全双工抢话已降级为半双工');
    expect(restored.duplexMode, 'full_duplex');
    expect(restored.message, '全双工抢话已恢复');
  });

  test('rejects events bound to another call or room', () {
    final payload = parseCallRoomData(
      utf8.encode(jsonEncode({
        'type': 'worker.status',
        'callId': 'call_2',
        'roomName': 'call_call_2',
        'text': '伪造状态',
      })),
      expectedCallId: 'call_1',
      expectedRoomName: 'call_call_1',
    );

    expect(payload.message, isNull);
    expect(payload.caption, isNull);
  });

  test('does not render unknown or malformed data payloads', () {
    final unknown = parseCallRoomData(utf8.encode(jsonEncode({
      'type': 'unknown.control',
      'text': '不应显示',
    })));
    final malformed = parseCallRoomData(const [0xff]);

    expect(unknown.message, isNull);
    expect(malformed.message, isNull);
  });
}
