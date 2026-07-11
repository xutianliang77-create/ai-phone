import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/platform/diagnostics/app_error_reporter.dart';

void main() {
  test('redacts app diagnostics before serialization', () {
    final report = AppErrorReport(
      eventType: 'flutter_error',
      message: 'Crash for 13800138000 and user@example.com',
      stackTrace: 'token=abc signedTransactionInfo:apple-jws',
      fatal: true,
      platform: 'ios',
      appVersion: '0.1.0',
      buildNumber: '1',
      regionEdition: 'domestic',
      dataRegion: 'cn',
      occurredAt: DateTime.utc(2026, 7, 3),
      context: const <String, Object?>{
        'sourceText': '你好',
        'route': '/pay?phone=13800138000',
        'nested': {'apiKey': 'provider-key'},
      },
    ).toJson();

    expect(report['message'], 'Crash for [REDACTED] and [REDACTED]');
    expect(
      report['stackTrace'],
      'token=[REDACTED] signedTransactionInfo=[REDACTED]',
    );
    expect(report['context'], {
      'sourceText': '[REDACTED]',
      'route': '/pay?phone=[REDACTED]',
      'nested': {'apiKey': '[REDACTED]'},
    });
  });

  test('posts app error reports to diagnostics endpoint', () async {
    Map<String, Object?>? postedBody;
    final reporter = AppErrorReporter(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      enabled: true,
      appVersion: '0.1.0',
      buildNumber: '1',
      regionEdition: 'domestic',
      dataRegion: 'cn',
      client: MockClient((request) async {
        postedBody = jsonDecode(request.body) as Map<String, Object?>;
        expect(request.method, 'POST');
        expect(request.url.path, '/diagnostics/app-errors');
        return http.Response(
          '{"status":"accepted","eventId":"event_1"}',
          202,
          headers: const {'content-type': 'application/json'},
        );
      }),
    );

    await reporter.reportError(
      Exception('boom 13800138000'),
      StackTrace.current,
      eventType: 'manual',
      fatal: false,
    );

    expect(postedBody?['eventType'], 'manual');
    expect(postedBody?['message'], 'Exception: boom [REDACTED]');
    expect(postedBody?['regionEdition'], 'domestic');
  });

  test('does not post when app error reporting is disabled', () async {
    var called = false;
    final reporter = AppErrorReporter(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      enabled: false,
      appVersion: '0.1.0',
      buildNumber: '1',
      regionEdition: 'domestic',
      dataRegion: 'cn',
      client: MockClient((request) async {
        called = true;
        return http.Response('{}', 202);
      }),
    );

    await reporter.reportError(
      Exception('boom'),
      StackTrace.current,
      eventType: 'manual',
      fatal: false,
    );

    expect(called, isFalse);
  });
}
