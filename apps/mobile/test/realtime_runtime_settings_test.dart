import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/platform/translation/supported_translation_language.dart';
import 'package:translation_mobile/src/features/realtime/data/local_realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_runtime_factories.dart';

part 'helpers/realtime_language_pair_cases.dart';

void main() {
  registerLanguagePairCases();
  test('applies on-device auto reverse settings to app config', () {
    const settings = RealtimeRuntimeSettings(
      processingMode: RealtimeProcessingMode.onDevice,
      sourceLanguage: autoSourceLanguageCode,
      targetLanguage: autoReverseTargetLanguageCode,
      voiceOutputMode: RealtimeVoiceOutputMode.natural,
    );

    final config = settings.applyTo(_baseConfig());

    expect(config.useDeviceAsr, isTrue);
    expect(config.useLocalSessions, isTrue);
    expect(config.useOnDeviceTranslation, isTrue);
    expect(config.sourceLanguage, 'auto');
    expect(config.targetLanguage, 'zh');
    expect(config.autoReverseTargetLanguage, isTrue);
  });

  test('applies online fixed target settings to app config', () {
    const settings = RealtimeRuntimeSettings(
      processingMode: RealtimeProcessingMode.online,
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      voiceOutputMode: RealtimeVoiceOutputMode.off,
    );

    final config = settings.applyTo(_baseConfig());

    expect(config.useDeviceAsr, isFalse);
    expect(config.useLocalSessions, isFalse);
    expect(config.useOnDeviceTranslation, isFalse);
    expect(config.sourceLanguage, 'en');
    expect(config.targetLanguage, 'ja');
    expect(config.autoReverseTargetLanguage, isFalse);
  });

  test('migrates legacy auto speak setting to natural voice', () {
    final settings = RealtimeRuntimeSettings.fromJson(const {
      'processingMode': 'online',
      'sourceLanguage': 'zh',
      'targetLanguage': 'en',
      'autoSpeakTranslation': true,
    });

    expect(settings.voiceOutputMode, RealtimeVoiceOutputMode.natural);
    expect(settings.voicePresetId, 'zh_female_natural');
    expect(settings.toJson()['voiceOutputMode'], 'natural');
  });

  test('persists the selected natural voice preset', () {
    final settings = RealtimeRuntimeSettings.fromJson(const {
      'processingMode': 'online',
      'sourceLanguage': 'zh',
      'targetLanguage': 'en',
      'voiceOutputMode': 'natural',
      'voicePresetId': 'zh_female_sichuanese',
    });

    final config = settings.applyTo(_baseConfig());

    expect(settings.voicePresetId, 'zh_female_sichuanese');
    expect(settings.toJson()['voicePresetId'], 'zh_female_sichuanese');
    expect(config.realtimeVoicePresetId, 'zh_female_sichuanese');
  });

  test('persists and applies the selected domain lexicon pack', () {
    final settings = RealtimeRuntimeSettings.fromJson(const {
      'processingMode': 'online',
      'sourceLanguage': 'zh',
      'targetLanguage': 'en',
      'voiceOutputMode': 'off',
      'domainLexiconPack': 'medical',
    });

    final config = settings.applyTo(_baseConfig());

    expect(settings.domainLexiconPack, 'medical');
    expect(settings.toJson()['domainLexiconPack'], 'medical');
    expect(config.domainLexiconPack, 'medical');
  });

  test('falls back to the general lexicon for unknown saved values', () {
    final settings = RealtimeRuntimeSettings.fromJson(const {
      'processingMode': 'online',
      'sourceLanguage': 'zh',
      'targetLanguage': 'en',
      'voiceOutputMode': 'off',
      'domainLexiconPack': 'unknown',
    });

    expect(settings.domainLexiconPack, 'product');
  });

  test('retains valid saved choices when local capabilities are unavailable',
      () {
    final settings = RealtimeRuntimeSettings.fromJson(const {
      'processingMode': 'onDevice',
      'sourceLanguage': 'fr',
      'targetLanguage': 'ja',
      'voiceOutputMode': 'my_voice',
      'domainLexiconPack': 'medical',
    });

    expect(settings.sourceLanguage, 'fr');
    expect(settings.targetLanguage, 'ja');
    expect(settings.voiceOutputMode, RealtimeVoiceOutputMode.myVoice);
    expect(settings.domainLexiconPack, 'medical');
    expect(settings.allowsSelectedVoiceMode, false);
  });

  test('allows explicit speech output in Listening sessions', () {
    final listening = _baseConfig().copyWith(
      realtimeMode: 'meeting',
      realtimeVoiceOutputMode: 'my_voice',
    );

    final effectiveListening = applyRealtimeModeVoicePolicy(listening);
    final effectiveTalk = applyRealtimeModeVoicePolicy(
      listening.copyWith(realtimeMode: 'conversation'),
    );

    expect(realtimeModeSupportsVoiceOutput('meeting'), isTrue);
    expect(effectiveListening.realtimeVoiceOutputMode, 'my_voice');
    expect(listening.realtimeVoiceOutputMode, 'my_voice');
    expect(effectiveTalk.realtimeVoiceOutputMode, 'my_voice');
  });

  test('online selection disables device inference but preserves online storage', () {
    final base = AppConfig(
      apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
      useMockAudio: false,
      useDeviceAsr: true,
      useOnDeviceTranslation: true,
      deviceAsrProvider: 'apple_speech_transcriber',
      deviceAsrLanguage: 'auto',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 256,
      serverOwnedHistory: true,
    );
    final settings = RealtimeRuntimeSettings.fromConfig(base);
    expect(settings.processingMode, RealtimeProcessingMode.online);
    final effective = settings.applyTo(base);
    expect(effective.useDeviceAsr, false);
    expect(effective.useOnDeviceTranslation, false);
    expect(effective.useLocalSessions, false);
    expect(effective.serverOwnedHistory, true);
  });

  test('local overrides do not rewrite deployment component policy on return',
      () {
    final base = _baseConfig();
    final online = RealtimeRuntimeSettings.fromConfig(base);
    final localConfig = online
        .copyWith(
          processingMode: RealtimeProcessingMode.onDevice,
        )
        .applyTo(base);
    expect(localConfig.useDeviceAsr, true);
    expect(localConfig.useOnDeviceTranslation, true);
    final restored = online.applyTo(localConfig);
    expect(restored.useDeviceAsr, false);
    expect(restored.useOnDeviceTranslation, false);
    expect(restored.useLocalSessions, false);
  });

  test(
      'mode roundtrip preserves language, voice, terms and legacy serialization',
      () {
    const online = RealtimeRuntimeSettings(
      processingMode: RealtimeProcessingMode.online,
      sourceLanguage: 'zh-Hant',
      targetLanguage: 'fr',
      voiceOutputMode: RealtimeVoiceOutputMode.myVoice,
      voicePresetId: 'user_saved_voice',
      domainLexiconPack: 'medical',
    );
    final local = online
        .copyWith(processingMode: RealtimeProcessingMode.onDevice)
        .normalizedForCapabilities();
    final saved = local.toJson();
    expect(saved['processingMode'], 'onDevice');
    final restored = RealtimeRuntimeSettings.fromJson(saved)
        .copyWith(processingMode: RealtimeProcessingMode.online);
    expect(restored.toJson(), online.toJson());
    expect(
        RealtimeRuntimeSettings.fromJson({...saved, 'processingMode': 'local'})
            .processingMode,
        RealtimeProcessingMode.onDevice);
  });

  test(
      'local personal voice is unavailable only in effective runtime, not preference',
      () {
    const settings = RealtimeRuntimeSettings(
      processingMode: RealtimeProcessingMode.onDevice,
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      voiceOutputMode: RealtimeVoiceOutputMode.myVoice,
    );
    final config = settings.applyTo(_baseConfig());
    expect(config.realtimeVoiceOutputMode, 'my_voice');
    expect(applyRealtimeModeVoicePolicy(config).realtimeVoiceOutputMode, 'off');
    expect(settings.voiceOutputMode, RealtimeVoiceOutputMode.myVoice);
    final online =
        settings.copyWith(processingMode: RealtimeProcessingMode.online);
    expect(
        applyRealtimeModeVoicePolicy(online.applyTo(config))
            .realtimeVoiceOutputMode,
        'my_voice');
  });

  test(
      'online always uses remote models after local roundtrip for all legacy flags',
      () {
    for (final asr in [false, true]) {
      for (final translation in [false, true]) {
        final base =
            _baseConfig(deviceAsr: asr, deviceTranslation: translation);
        final online = RealtimeRuntimeSettings.fromConfig(base);
        final local = online
            .copyWith(processingMode: RealtimeProcessingMode.onDevice)
            .applyTo(base);
        final restored = online.applyTo(local);
        expect(restored.useDeviceAsr, false);
        expect(restored.useOnDeviceTranslation, false);
        expect(restored.useLocalSessions, false);
        final localRepository = createDefaultRealtimeRepository(local);
        final onlineRepository = createDefaultRealtimeRepository(restored);
        expect(localRepository, isA<LocalRealtimeRepository>());
        expect(onlineRepository, isNot(isA<LocalRealtimeRepository>()));
        localRepository.dispose();
        onlineRepository.dispose();
      }
    }
  });
}

AppConfig _baseConfig(
    {bool deviceAsr = false, bool deviceTranslation = false}) {
  return AppConfig(
    apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
    useMockAudio: false,
    useDeviceAsr: deviceAsr,
    useOnDeviceTranslation: deviceTranslation,
    autoReverseTargetLanguage: false,
    deviceAsrProvider: 'coreml_nemotron',
    deviceAsrLanguage: 'auto',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    serverOwnedHistory: true,
  );
}
