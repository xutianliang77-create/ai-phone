import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/voice_identity/data/voice_identity_api_client.dart';

void main() {
  test('creates a consented identity with account authorization', () async {
    final client = VoiceIdentityApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/voice-identities');
        expect(request.headers['authorization'], 'Bearer test-token');
        expect(jsonDecode(request.body), {
          'displayName': '张经理',
          'consentAccepted': true,
          'consentVersion': 'domestic-voice-identity-v1',
        });
        return _identityResponse('pending_enrollment');
      }),
    );

    final identity = await client.create(
      displayName: '张经理',
      consentVersion: 'domestic-voice-identity-v1',
    );

    expect(identity.displayName, '张经理');
    expect(identity.status, 'pending_enrollment');
  });

  test('enrolls and revokes only the requested identity', () async {
    final requests = <String>[];
    final client = VoiceIdentityApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        requests.add('${request.method} ${request.url.path}');
        expect(request.headers['authorization'], 'Bearer test-token');
        if (request.url.path.endsWith('/reference-audio')) {
          expect(jsonDecode(request.body), {'audioBase64': 'UklGRg=='});
          return _identityResponse('ready');
        }
        return _identityResponse('revoked');
      }),
    );

    final enrolled = await client.enroll(
      identityId: 'identity_1',
      audioBase64: 'UklGRg==',
    );
    final revoked = await client.revoke('identity_1');

    expect(enrolled.ready, isTrue);
    expect(revoked.status, 'revoked');
    expect(requests, [
      'POST /voice-identities/identity_1/reference-audio',
      'POST /voice-identities/identity_1/revoke',
    ]);
  });

  test('surfaces API failures without accepting a partial identity', () async {
    final client = VoiceIdentityApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: _sessionStore(),
      client: MockClient((_) async => http.Response(
            jsonEncode({
              'error': {'code': 'voice_identity_consent_required'},
            }),
            400,
          )),
    );

    await expectLater(
      client.create(
        displayName: '未授权',
        consentVersion: 'domestic-voice-identity-v1',
      ),
      throwsA(isA<VoiceIdentityApiException>()),
    );
  });
}

MemoryAccountSessionStore _sessionStore() {
  return MemoryAccountSessionStore(
    const AccountSession(
      token: 'test-token',
      expiresAtIso: '2099-01-01T00:00:00.000Z',
    ),
  );
}

http.Response _identityResponse(String status) {
  return http.Response(
    jsonEncode({
      'identity': {
        'id': 'identity_1',
        'displayName': '张经理',
        'status': status,
        'matchThreshold': 0.72,
      },
    }),
    200,
    headers: const {'content-type': 'application/json'},
  );
}
