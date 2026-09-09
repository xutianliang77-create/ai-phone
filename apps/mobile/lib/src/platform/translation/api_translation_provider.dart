import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../features/account/data/account_auth_headers.dart';
import '../../features/account/data/account_session_store.dart';
import 'mobile_translation_provider.dart';

class ApiTranslationProvider implements MobileTranslationProvider {
  ApiTranslationProvider({
    required Uri baseUrl,
    http.Client? client,
    AccountSessionStore? accountSessionStore,
    MobileTranslationProvider? fallback,
  })  : _baseUrl = baseUrl,
        _client = client ?? http.Client(),
        _accountSessionStore = accountSessionStore ?? accountStoreForDeployment(baseUrl),
        _fallback = fallback;

  final Uri _baseUrl;
  final http.Client _client;
  final AccountSessionStore _accountSessionStore;
  final MobileTranslationProvider? _fallback;

  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    try {
      final response = await _client.post(
        _baseUrl.resolve('/translation/text'),
        headers: await accountAuthorizationHeaders(
          _accountSessionStore,
          baseHeaders: const {'content-type': 'application/json'},
        ),
        body: jsonEncode(<String, String>{
          'text': text,
          'sourceLanguage': config.sourceLanguage,
          'targetLanguage': config.targetLanguage,
        }),
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return _fallback?.translate(text, config);
      }
      final payload = jsonDecode(response.body) as Map<String, Object?>;
      final translatedText = (payload['text'] as String?)?.trim() ?? '';
      if (translatedText.isEmpty) return _fallback?.translate(text, config);
      return MobileTranslationResult(
        text: translatedText,
        provider: payload['provider'] as String? ?? 'server',
      );
    } on Object {
      return _fallback?.translate(text, config);
    }
  }

  @override
  Future<void> dispose() async {
    _client.close();
    await _fallback?.dispose();
  }
}
