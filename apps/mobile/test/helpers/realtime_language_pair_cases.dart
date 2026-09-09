part of '../realtime_runtime_settings_test.dart';

void registerLanguagePairCases() {
  const selected = RealtimeRuntimeSettings(
    processingMode: RealtimeProcessingMode.online,
    sourceLanguage: 'fr',
    targetLanguage: 'ja',
    voiceOutputMode: RealtimeVoiceOutputMode.off,
  );
  test('explicit pair survives both automatic settings and mode round trip',
      () {
    final automatic = selected
        .copyWith(sourceLanguage: 'auto')
        .copyWith(targetLanguage: 'auto_reverse');
    final saved = automatic.toJson();
    expect(saved['automaticLanguagePair'], {'source': 'fr', 'target': 'ja'});
    final restored = RealtimeRuntimeSettings.fromJson(saved)
        .copyWith(processingMode: RealtimeProcessingMode.onDevice)
        .copyWith(processingMode: RealtimeProcessingMode.online);
    expect(restored.toJson(), saved);
    final config = restored.applyTo(_baseConfig());
    expect(config.sourceLanguage, 'auto');
    expect(config.targetLanguage, 'ja');
    expect(config.automaticLanguagePair?.source, 'fr');
    expect(config.automaticLanguagePair?.target, 'ja');
    expect(
        config
            .copyWith(realtimeVoiceOutputMode: 'natural')
            .automaticLanguagePair
            ?.source,
        'fr');
    expect(
        createOnDeviceTranslationPreflightConfigs(config)
            .map((p) => '${p.sourceLanguage}->${p.targetLanguage}'),
        ['fr->ja', 'ja->fr']);
  });

  test('reverse setting order and fixed reverse side preserve pair', () {
    final automatic = selected
        .copyWith(targetLanguage: 'auto_reverse')
        .copyWith(sourceLanguage: 'auto');
    final reversed = automatic.copyWith(sourceLanguage: 'ja');
    expect(reversed.applyTo(_baseConfig()).targetLanguage, 'fr');
    expect(automatic.selectedLanguagePair?.toJson(),
        {'source': 'fr', 'target': 'ja'});
  });

  test('explicit new pair overrides cache; unmatched selection clears old pair',
      () {
    final base = selected.applyTo(_baseConfig());
    final changed = selected
        .copyWith(targetLanguage: 'auto_reverse')
        .copyWith(sourceLanguage: 'de');
    expect(changed.selectedLanguagePair, isNull);
    expect(changed.applyTo(base).automaticLanguagePair, isNull);
    final replaced = changed.copyWith(targetLanguage: 'it');
    expect(replaced.selectedLanguagePair?.toJson(),
        {'source': 'de', 'target': 'it'});
    expect(replaced.applyTo(base).automaticLanguagePair?.source, 'de');
  });

  test('legacy auto settings have no invented pair; fixed settings derive pair',
      () {
    final legacy = RealtimeRuntimeSettings.fromJson({
      'sourceLanguage': 'auto',
      'targetLanguage': 'auto_reverse',
    });
    expect(legacy.selectedLanguagePair, isNull);
    expect(legacy.applyTo(_baseConfig()).targetLanguage, 'zh');
    expect(legacy.toJson().containsKey('automaticLanguagePair'), false);
    final fixed = RealtimeRuntimeSettings.fromJson({
      'sourceLanguage': 'fr',
      'targetLanguage': 'ja',
    });
    expect(fixed.selectedLanguagePair?.source, 'fr');
  });

  test('malformed persisted pair cannot become capability or routing evidence',
      () {
    for (final value in [
      null,
      1,
      ['fr', 'ja'],
      {'source': 'auto', 'target': 'ja'},
      {'source': 'fr', 'target': 'fr'},
      {'source': 'zz', 'target': 'ja'}
    ]) {
      final loaded = RealtimeRuntimeSettings.fromJson({
        'sourceLanguage': 'auto',
        'targetLanguage': 'auto_reverse',
        'automaticLanguagePair': value,
      });
      expect(loaded.selectedLanguagePair, isNull);
    }
  });
}
