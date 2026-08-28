import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';

void main() {
  test('sends authenticated Air780 DTMF with its idempotency key', () async {
    final client = CallLinkApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: MemoryAccountSessionStore(
        const AccountSession(
          token: 'test-token',
          expiresAtIso: '2026-08-14T00:00:00.000Z',
        ),
      ),
      client: MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/call-links/call-1/air780-dtmf');
        expect(request.headers['authorization'], 'Bearer test-token');
        expect(jsonDecode(request.body), <String, Object?>{
          'digit': '#',
          'idempotencyKey': 'dtmf-key-0001',
        });
        return http.Response(
          jsonEncode(<String, Object?>{
            'callId': 'call-1',
            'sessionId': 'call-1',
            'operationId': 'operation-1',
            'operationType': 'phone_dtmf',
            'status': 'accepted',
            'replayed': false,
          }),
          202,
          headers: const {'content-type': 'application/json'},
        );
      }),
    );

    final result = await client.sendAir780Dtmf(
      callId: 'call-1',
      digit: '#',
      idempotencyKey: 'dtmf-key-0001',
    );

    expect(result.operationType, 'phone_dtmf');
    expect(result.status, 'accepted');
    expect(result.replayed, isFalse);
  });
}
