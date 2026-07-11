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
