import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';

void main() {
  test('uses authenticated account routes for translation call controls',
      () async {
    final requests = <http.Request>[];
    final client = CallLinkApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: MemoryAccountSessionStore(
        const AccountSession(
          token: 'test-token',
          expiresAtIso: '2026-08-14T00:00:00.000Z',
        ),
      ),
      client: MockClient((request) async {
        requests.add(request);
        expect(request.headers['authorization'], 'Bearer test-token');
        if (request.url.path.endsWith('/diagnostic-marker')) {
          return http.Response(jsonEncode({
            'callId': 'call-1',
            'sessionId': 'session-1',
            'markerId': 'diag-1',
            'category': 'unexpected_audio',
            'createdAt': '2026-08-13T08:00:00.000Z',
            'replayed': false,
          }), 202);
        }
        return http.Response(jsonEncode({
          'callId': 'call-1',
          'sessionId': 'session-1',
          'operationId': 'control-1',
          'operationType': request.url.path.endsWith('/type-to-speak')
              ? 'translation_type_to_speak'
              : 'translation_uplink_control',
          'status': 'succeeded',
          'replayed': false,
          'controlGeneration': 2,
          'uplinkPaused': request.url.path.endsWith('/translation-uplink'),
        }), request.method == 'POST' ? 202 : 200);
      }),
    );

    await client.typeToSpeak(
      callId: 'call-1',
      text: '请稍等',
      idempotencyKey: 'typed-key-0001',
    );
    await client.setTranslationUplinkPaused(
      callId: 'call-1',
      paused: true,
      idempotencyKey: 'pause-key-0001',
    );
    await client.getTranslationControlStatus(
      callId: 'call-1',
      operationId: 'control-1',
    );
    await client.reportCallDiagnosticMarker(
      callId: 'call-1',
      category: 'unexpected_audio',
      idempotencyKey: 'marker-key-0001',
    );

    expect(requests.map((request) => request.url.path), [
      '/call-links/call-1/type-to-speak',
      '/call-links/call-1/translation-uplink',
      '/call-links/call-1/translation-controls/control-1',
      '/call-links/call-1/diagnostic-marker',
    ]);
    expect(jsonDecode(requests[0].body), {
      'text': '请稍等',
      'idempotencyKey': 'typed-key-0001',
    });
    expect(jsonDecode(requests[1].body), {
      'paused': true,
      'idempotencyKey': 'pause-key-0001',
    });
    expect(jsonDecode(requests[3].body), {
      'category': 'unexpected_audio',
      'idempotencyKey': 'marker-key-0001',
    });
  });
}
