import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_gateway_diagnostic.dart';

void main() {
  test('keeps translation failure provider diagnostics', () {
    final event = GatewayRealtimeEvent.fromJson(<String, Object?>{
      'type': 'translation.failed',
      'sessionId': 'sess_1',
      'segmentId': 'seg_1',
      'message': '翻译暂不可用',
      'language': 'en',
      'stage': 'translation',
      'provider': 'hymt2_self_hosted',
      'retryable': true,
    });

    final diagnostic = RealtimeGatewayDiagnostic.fromEvent(
      event,
      displayMessage: '翻译暂不可用',
    );

    expect(diagnostic.type, 'translation.failed');
    expect(diagnostic.stage, 'translation');
    expect(diagnostic.provider, 'hymt2_self_hosted');
    expect(diagnostic.isRetryable, isTrue);
  });

  test('parses quota end metadata from gateway events', () {
    final event = GatewayRealtimeEvent.fromJson(<String, Object?>{
      'type': 'session.ended',
      'sessionId': 'sess_1',
      'reason': 'quota_exhausted',
      'billableSeconds': 300,
      'remainingSeconds': 0,
    });

    expect(event.reason, 'quota_exhausted');
    expect(event.billableSeconds, 300);
    expect(event.remainingSeconds, 0);
  });

  test('parses successful final flush metadata', () {
    final event = GatewayRealtimeEvent.fromJson(<String, Object?>{
      'type': 'session.ended',
      'sessionId': 'sess_1',
      'flush': <String, Object?>{
        'status': 'completed',
        'transcriptFinalCount': 1,
        'translationFinalCount': 1,
        'translationFailedCount': 0,
        'unresolvedSegmentCount': 0,
        'pipelineErrorCount': 0,
        'audioFlushed': true,
        'providerFlushed': true,
      },
    });

    expect(event.flush?.isSuccessful, isTrue);
    expect(event.flush?.transcriptFinalCount, 1);
    expect(event.flush?.translationFinalCount, 1);
  });

  test('rejects degraded final flush metadata', () {
    final event = GatewayRealtimeEvent.fromJson(<String, Object?>{
      'type': 'session.ended',
      'sessionId': 'sess_1',
      'flush': <String, Object?>{
        'status': 'degraded',
        'unresolvedSegmentCount': 1,
        'audioFlushed': true,
        'providerFlushed': false,
      },
    });

    expect(event.flush?.isSuccessful, isFalse);
  });

  test('parses final flush metadata from websocket JSON', () {
    final json = jsonDecode('''{
      "type":"session.ended",
      "sessionId":"sess_1",
      "flush":{
        "status":"empty",
        "transcriptFinalCount":0,
        "translationFinalCount":0,
        "translationFailedCount":0,
        "unresolvedSegmentCount":0,
        "pipelineErrorCount":0,
        "audioFlushed":true,
        "providerFlushed":true
      }
    }''') as Map<String, Object?>;

    final event = GatewayRealtimeEvent.fromJson(json);
    expect(event.flush?.status, 'empty');
    expect(event.flush?.isSuccessful, isTrue);
  });

  test('parses low balance usage ticks from gateway events', () {
    final event = GatewayRealtimeEvent.fromJson(<String, Object?>{
      'type': 'usage.tick',
      'sessionId': 'sess_1',
      'billableSeconds': 270,
      'remainingSeconds': 15,
      'lowBalance': true,
    });

    expect(event.type, 'usage.tick');
    expect(event.billableSeconds, 270);
    expect(event.remainingSeconds, 15);
    expect(event.lowBalance, isTrue);
  });

  test('parses provider usage diagnostics from translation events', () {
    final event = GatewayRealtimeEvent.fromJson(<String, Object?>{
      'type': 'translation.final',
      'sessionId': 'sess_1',
      'segmentId': 'seg_1',
      'text': '你好',
      'language': 'zh',
      'confidence': 0.92,
      'providerUsage': <String, Object?>{
        'provider': 'hymt2_self_hosted',
        'model': 'tencent/Hy-MT2-1.8B',
        'latencyMs': 410,
      },
    });

    expect(event.language, 'zh');
    expect(event.confidence, 0.92);
    expect(event.provider, 'hymt2_self_hosted');
    expect(event.model, 'tencent/Hy-MT2-1.8B');
    expect(event.latencyMs, 410);
  });
}
