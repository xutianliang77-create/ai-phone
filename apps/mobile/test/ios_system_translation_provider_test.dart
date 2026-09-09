import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/translation/ios_system_translation_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';
import 'package:translation_mobile/src/platform/translation/translation_language_pair.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('translation_mobile/on_device_translation');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  const pair =
      MobileTranslationConfig(sourceLanguage: 'fr', targetLanguage: 'ja');
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('preserves requested languages and accepts equivalent SDK locales',
      () async {
    messenger.setMockMethodCallHandler(channel, (call) async {
      expect((call.arguments as Map)['sourceLanguage'], 'fr');
      expect((call.arguments as Map)['targetLanguage'], 'ja');
      return {
        'available': true,
        'status': 'installed',
        'sourceLanguage': 'fr-FR',
        'targetLanguage': 'ja-JP',
        'text': 'こんにちは',
        'provider': 'ios_system'
      };
    });
    final provider = IosSystemTranslationProvider();
    expect((await provider.availability(pair)).available, true);
    expect((await provider.translate('Bonjour', pair))?.text, 'こんにちは');
  });
  test('rejects the old en-zh fallback at readiness and translation boundaries',
      () async {
    messenger.setMockMethodCallHandler(
        channel,
        (_) async => {
              'available': true,
              'status': 'installed',
              'sourceLanguage': 'en',
              'targetLanguage': 'zh',
              'text': 'wrong language'
            });
    final fallback = _Fallback();
    final provider = IosSystemTranslationProvider(fallback: fallback);
    final ready = await provider.availability(pair);
    expect(ready.available, false);
    expect(ready.reason, 'translation_language_mismatch');
    await expectLater(
        provider.translate('Bonjour', pair),
        throwsA(isA<PlatformException>()
            .having((e) => e.code, 'code', 'translation_language_mismatch')));
    expect(fallback.calls, 0);
  });
  test('missing language metadata cannot qualify an old bridge', () async {
    messenger.setMockMethodCallHandler(
        channel, (_) async => {'available': true, 'text': 'text'});
    final provider = IosSystemTranslationProvider();
    expect((await provider.availability(pair)).available, false);
    await expectLater(
        provider.translate('Bonjour', pair), throwsA(isA<PlatformException>()));
  });
  test('keeps native missing-resource errors instead of returning null',
      () async {
    messenger.setMockMethodCallHandler(channel, (_) async {
      throw PlatformException(
          code: 'language_pair_not_installed',
          message: 'Download the requested language resources first.');
    });
    final provider = IosSystemTranslationProvider();
    expect((await provider.availability(pair)).reason,
        'language_pair_not_installed');
    await expectLater(
        provider.translate('Bonjour', pair),
        throwsA(isA<PlatformException>()
            .having((e) => e.code, 'code', 'language_pair_not_installed')));
  });
  test('empty native output is an explicit error after language validation',
      () async {
    messenger.setMockMethodCallHandler(
        channel,
        (_) async =>
            {'sourceLanguage': 'fr', 'targetLanguage': 'ja', 'text': ' '});
    await expectLater(
        IosSystemTranslationProvider().translate('Bonjour', pair),
        throwsA(isA<PlatformException>()
            .having((e) => e.code, 'code', 'empty_translation')));
  });
  test(
      'traditional Chinese and Cantonese cannot silently become Mandarin simplified',
      () {
    expect(canonicalTranslationLanguageCode('zh_Hant_TW'), 'zh-Hant');
    expect(canonicalTranslationLanguageCode('zh-TW'), 'zh-Hant');
    expect(canonicalTranslationLanguageCode('cmn-Hans-CN'), 'zh');
    expect(canonicalTranslationLanguageCode('yue-HK'), 'yue');
    expect(translationLanguagesMatch('zh-CN', 'zh-Hant'), false);
    expect(translationLanguagesMatch('zh', 'yue'), false);
    for (final value in ['auto', 'garbage', 'fr??', 'en--US', 'xx']) {
      expect(canonicalTranslationLanguageCode(value), null);
    }
    expect(
        const MobileTranslationAvailability(
                available: true,
                provider: 'test',
                sourceLanguage: 'en',
                targetLanguage: 'zh',
                status: 'installed',
                reason: 'ready')
            .matchesLanguagePair(pair),
        false);
  });
}

class _Fallback implements MobileTranslationProvider {
  int calls = 0;
  @override
  Future<MobileTranslationResult?> translate(
      String text, MobileTranslationConfig config) async {
    calls++;
    return const MobileTranslationResult(text: 'fallback', provider: 'test');
  }

  @override
  Future<void> dispose() async {}
}
