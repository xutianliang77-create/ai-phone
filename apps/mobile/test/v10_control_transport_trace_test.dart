import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:translation_mobile/src/platform/diagnostics/control_transport_trace.dart';

class _Documents extends PathProviderPlatform {
  _Documents(this.path);
  final String path;
  @override
  Future<String?> getApplicationDocumentsPath() async => path;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const id = '0123456789abcdef01234567';
  test('only approved metadata and error codes survive sanitization', () {
    expect(newControlDiagnosticId(path: '/private'), isNull);
    final event = sanitizeControlTransportEvent(
      id: id,
      path: '/v10/device/close',
      phase: 'native_task_metrics',
      method: 'POST',
      elapsedMs: 17,
      errorDomain: 'secret-domain',
      errorType: 'Bearer-secret',
      cfRay: 'sensitive-header',
      serverCode: 'sensitive-error',
      metrics: [
        {
          'dnsMs': 5,
          'proxy': true,
          'protocol': 'h2',
          'authorization': 'Bearer-secret',
          'remoteAddress': '192.0.2.2',
          'tlsMs': -99,
        },
      ],
    )!;
    final json = jsonEncode(event);
    expect(json, isNot(contains('secret')));
    expect(json, isNot(contains('192.0.2.2')));
    expect(json, isNot(contains('tlsMs')));
    expect(event['metrics'], [
      {'dnsMs': 5, 'proxy': true, 'protocol': 'h2'},
    ]);
    expect(
      sanitizeControlTransportEvent(
        id: id,
        path: '/private',
        phase: 'request_failed',
        method: 'POST',
        elapsedMs: 1,
      ),
      isNull,
    );
    expect(
      controlDiagnosticServerCode(
        409,
        utf8.encode(
          jsonEncode({
            'error': {
              'code': 'd1_idempotency_conflict',
              'message': 'private text',
            },
          }),
        ),
      ),
      'd1_idempotency_conflict',
    );
    expect(
      controlDiagnosticServerCode(
        409,
        utf8.encode('{"error":{"code":"private_text"}}'),
      ),
      isNull,
    );
  });

  test(
    'bounded diagnostic file retains safe prior events and leaves legacy trace intact',
    () async {
      expect(newControlDiagnosticId(), matches(RegExp(r'^[a-f0-9]{24}$')));
      final dir = await Directory.systemTemp.createTemp('v10-control-trace-');
      final previous = PathProviderPlatform.instance;
      PathProviderPlatform.instance = _Documents(dir.path);
      final legacy = File('${dir.path}/wujie-public-control-requests.json');
      final diagnostic = File(
        '${dir.path}/wujie-control-transport-diagnostics-v2.json',
      );
      try {
        await legacy.writeAsString('legacy-evidence');
        await diagnostic.writeAsString(
          jsonEncode({
            'events': [
              {
                'id': id,
                'path': '/v10/device/close',
                'phase': 'request_failed',
                'method': 'POST',
                'elapsedMs': 12,
                'authorization': 'Bearer-secret',
                'metrics': [
                  {'proxy': true, 'rawBody': 'private text'},
                ],
              },
            ],
          }),
        );
        for (var i = 0; i < 130; i++) {
          recordControlTransportEvent(
            id: id,
            path: '/v10/device/close',
            phase: 'request_failed',
            method: 'POST',
            elapsedMs: i,
            errorType: 'Bearer-secret',
            metrics: [
              {'responseMs': 4, 'secret': 'Bearer-secret'},
            ],
          );
        }
        await waitForControlDiagnosticWrites();
        final raw = await diagnostic.readAsString();
        final data = jsonDecode(raw) as Map;
        expect((data['events'] as List).length, 128);
        expect(raw, isNot(contains('Bearer-secret')));
        expect(raw, isNot(contains('private text')));
        expect(await legacy.readAsString(), 'legacy-evidence');
      } finally {
        PathProviderPlatform.instance = previous;
        await dir.delete(recursive: true);
      }
    },
  );
}
