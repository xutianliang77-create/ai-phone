import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';

void main() {
  test('reads provider-neutral phone status with account authorization',
      () async {
    final client = CallLinkApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: MemoryAccountSessionStore(const AccountSession(
        token: 'test-token',
        expiresAtIso: '2026-08-14T00:00:00.000Z',
      )),
      client: MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/call-links/call-1/phone-status');
        expect(request.headers['authorization'], 'Bearer test-token');
        return http.Response(jsonEncode({
          'callId': 'call-1',
          'sessionId': 'call-1',
          'operationId': 'sip-operation-1',
          'provider': 'livekit_sip',
          'providerOperationStatus': 'active',
          'providerCallId': 'sip-call-1',
        }), 200);
      }),
    );

    final result = await client.getPhoneStatus(callId: 'call-1');

    expect(result.provider, 'livekit_sip');
    expect(result.providerOperationStatus, 'active');
    expect(result.carrierState, isNull);
  });
}
