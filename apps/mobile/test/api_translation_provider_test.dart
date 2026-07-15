import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/platform/translation/api_translation_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';
import 'package:translation_mobile/src/platform/translation/phrasebook_translation_provider.dart';

void main() {
  test('sends account-scoped text translation to the server', () async {
    final provider = ApiTranslationProvider(
      baseUrl: Uri.parse('https://api.example.cn'),
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        expect(request.url.path, '/translation/text');
        expect(request.headers['authorization'], 'Bearer account-token');
        expect(jsonDecode(request.body), <String, Object?>{
          'text': '周末适合搬家吗？',
          'sourceLanguage': 'zh',
          'targetLanguage': 'en',
        });
        return http.Response(
          jsonEncode(<String, Object?>{
            'text': 'Is the weekend suitable for moving?',
            'provider': 'hymt2',
          }),
          200,
        );
      }),
    );

    final result = await provider.translate(
      '周末适合搬家吗？',
      const MobileTranslationConfig(
        sourceLanguage: 'zh',
        targetLanguage: 'en',
      ),
    );

    expect(result?.text, 'Is the weekend suitable for moving?');
    expect(result?.provider, 'hymt2');
  });

  test('falls back when the server is unavailable', () async {
    final provider = ApiTranslationProvider(
      baseUrl: Uri.parse('https://api.example.cn'),
      accountSessionStore: _sessionStore(),
      client: MockClient((_) async => http.Response('{}', 503)),
      fallback: PhrasebookTranslationProvider(),
    );

    final result = await provider.translate(
      '你好',
      const MobileTranslationConfig(
        sourceLanguage: 'zh',
        targetLanguage: 'en',
      ),
    );

    expect(result?.text, 'Hello');
    expect(result?.provider, 'phrasebook');
  });
}

MemoryAccountSessionStore _sessionStore() {
  return MemoryAccountSessionStore(
    const AccountSession(
      token: 'account-token',
      expiresAtIso: '2099-01-01T00:00:00.000Z',
    ),
  );
}
