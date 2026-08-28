import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/app/localization/app_call_link_error_localizations.dart';
import 'package:translation_mobile/src/features/account/data/account_auth_headers.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';
import 'package:translation_mobile/src/features/pstn_call/presentation/pstn_call_error_message.dart';

void main() {
  test('preserves a structured API error without exposing the raw body',
      () async {
    final client = _client(http.Response(
      jsonEncode(<String, Object?>{
        'error': <String, Object?>{
          'code': 'air780_outbound_failed',
          'message': 'Air780 rejected the outbound call',
        },
      }),
      503,
    ));

    await expectLater(
      _startAir780(client),
      throwsA(
        isA<CallLinkApiException>()
            .having((error) => error.code, 'code', 'air780_outbound_failed')
            .having((error) => error.statusCode, 'statusCode', 503)
            .having(
              (error) => error.toString(),
              'safe message',
              'Start Air780 outbound failed',
            ),
      ),
    );
  });

  test('replaces an unstructured server body with an operation fallback',
      () async {
    final client = _client(http.Response('private gateway diagnostics', 502));

    await expectLater(
      _startAir780(client),
      throwsA(
        isA<CallLinkApiException>()
            .having((error) => error.code, 'code', isNull)
            .having(
              (error) => error.message,
              'message',
              'Start Air780 outbound failed',
            )
            .having(
              (error) => error.toString(),
              'raw body',
              isNot(contains('private gateway diagnostics')),
            ),
      ),
    );
  });

  test('maps Air780 failures to an actionable localized message', () {
    const error = CallLinkApiException(
      'internal detail',
      code: 'air780_hangup_failed',
      statusCode: 503,
    );

    final message = pstnCallErrorMessage(error, chinese: true);

    expect(message, contains('电话可能仍在进行'));
    expect(message, contains('结束通话'));
    expect(message, isNot(contains('internal detail')));
  });

  test('maps missing local account state to sign-in guidance', () {
    expect(
      pstnCallErrorMessage(const AccountAuthRequiredException(), chinese: true),
      '请先登录账号后再拨打。',
    );
  });

  test('keeps generic Call Link failures user-readable in Chinese', () {
    expect(
      appCallLinkErrorMessage('Create call link failed'),
      '创建通话失败，请稍后重试',
    );
    expect(
      appCallLinkErrorMessage('Confirm room connection failed'),
      '确认通话连接失败，请重新进入房间',
    );
  });
}

CallLinkApiClient _client(http.Response response) {
  return CallLinkApiClient(
    baseUrl: Uri.parse('http://127.0.0.1:3100'),
    accountSessionStore: MemoryAccountSessionStore(
      const AccountSession(
        token: 'test-token',
        expiresAtIso: '2026-08-14T00:00:00.000Z',
      ),
    ),
    client: MockClient((_) async => response),
  );
}

Future<SipOutboundCall> _startAir780(CallLinkApiClient client) {
  return client.startAir780Outbound(
    callId: 'call-1',
    targetPhone: '+8613800000000',
    sourceLanguage: 'zh',
    targetLanguage: 'en',
    disclosureConfirmed: true,
  );
}
