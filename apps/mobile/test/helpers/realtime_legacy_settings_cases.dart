part of '../realtime_runtime_settings_test.dart';

void registerLegacySettingsCases() {
  test(
      'restores only the explicit public build pair into legacy online auto settings',
      () {
    final base = _baseConfig().copyWith(
      sourceLanguage: autoSourceLanguageCode,
      targetLanguage: 'en',
      autoReverseTargetLanguage: true,
      automaticLanguagePair: const TranslationLanguagePair('zh', 'en'),
    );
    final legacy = RealtimeRuntimeSettings.fromJson(const {
      'processingMode': 'online',
      'sourceLanguage': 'auto',
      'targetLanguage': 'auto_reverse',
      'voiceOutputMode': 'off',
    });

    final restored = resolveRealtimeRuntimeSettings(base, legacy);

    expect(restored.selectedLanguagePair?.toJson(),
        {'source': 'zh', 'target': 'en'});
    expect(restored.toStorageJson()['automaticLanguagePair'],
        {'source': 'zh', 'target': 'en'});
    expect(restored.applyTo(base).automaticLanguagePair?.toJson(),
        {'source': 'zh', 'target': 'en'});
  });

  test('does not overwrite an explicit current-version empty automatic pair',
      () {
    final base = _baseConfig().copyWith(
      sourceLanguage: autoSourceLanguageCode,
      targetLanguage: 'en',
      autoReverseTargetLanguage: true,
      automaticLanguagePair: const TranslationLanguagePair('zh', 'en'),
    );
    final current = RealtimeRuntimeSettings.fromJson(const {
      'processingMode': 'online',
      'sourceLanguage': 'auto',
      'targetLanguage': 'auto_reverse',
      'voiceOutputMode': 'off',
      'settingsSchemaVersion': 2,
      'automaticLanguagePair': null,
    });

    expect(identical(resolveRealtimeRuntimeSettings(base, current), current),
        isTrue);
  });

  test('migrates legacy fixed-source automatic reverse to the build auto source',
      () {
    final base = _baseConfig().copyWith(
      sourceLanguage: autoSourceLanguageCode,
      targetLanguage: 'en',
      autoReverseTargetLanguage: true,
      automaticLanguagePair: const TranslationLanguagePair('zh', 'en'),
    );
    final legacy = RealtimeRuntimeSettings.fromJson(const {
      'processingMode': 'online',
      'sourceLanguage': 'en',
      'targetLanguage': 'auto_reverse',
      'voiceOutputMode': 'off',
      'automaticLanguagePair': {'source': 'en', 'target': 'zh'},
    });

    final restored = resolveRealtimeRuntimeSettings(base, legacy);

    expect(restored.sourceLanguage, autoSourceLanguageCode);
    expect(restored.selectedLanguagePair?.toJson(),
        {'source': 'zh', 'target': 'en'});
    expect(restored.applyTo(base).targetLanguage, 'en');
  });

  test('uses the same legacy pair recovery for shared settings consumers',
      () async {
    final base = _baseConfig().copyWith(
      sourceLanguage: autoSourceLanguageCode,
      targetLanguage: 'en',
      autoReverseTargetLanguage: true,
      automaticLanguagePair: const TranslationLanguagePair('zh', 'en'),
    );
    final legacy = RealtimeRuntimeSettings.fromJson(const {
      'processingMode': 'online',
      'sourceLanguage': 'auto',
      'targetLanguage': 'auto_reverse',
      'voiceOutputMode': 'off',
    });

    final config = await resolveRealtimeSettingsConfig(
      base,
      MemoryRealtimeSettingsStore(legacy),
    );

    expect(config.automaticLanguagePair?.toJson(),
        {'source': 'zh', 'target': 'en'});
  });
}
