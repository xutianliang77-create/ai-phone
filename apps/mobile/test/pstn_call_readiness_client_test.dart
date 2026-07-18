import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/pstn_call/data/pstn_call_readiness_client.dart';

void main() {
  test('fetches PSTN readiness from API health', () async {
    final client = PstnCallReadinessClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      client: MockClient((request) async {
        expect(request.url.path, '/health');
        return http.Response(
          jsonEncode(<String, Object?>{
            'pstnReadiness': <String, Object?>{
              'status': 'ready',
              'policy': 'pstn_enabled',
              'enabled': true,
              'provider': 'telnyx',
              'issues': <Object?>[],
            },
          }),
          200,
        );
      }),
    );

    final readiness = await client.fetch();

    expect(readiness.isReady, isTrue);
    expect(readiness.provider, 'telnyx');
  });

  test('rejects an unsuccessful health response', () async {
    final client = PstnCallReadinessClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      client: MockClient((_) async => http.Response('{}', 503)),
    );

    await expectLater(
      client.fetch(),
      throwsA(isA<PstnCallReadinessException>()),
    );
  });
}
