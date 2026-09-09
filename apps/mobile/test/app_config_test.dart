import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/app/region_edition_config.dart';

void main() {
  test(
      'Apple ASR defaults and explicit duration overrides survive config copies',
      () {
    AppConfig apple({int? chunk, int? minSpeech, int? silence}) => AppConfig(
          apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
          useMockAudio: false,
          useDeviceAsr: true,
          deviceAsrProvider: 'apple_speech_transcriber',
          deviceAsrLanguage: 'fr',
          deviceAsrAutoDownloadModel: false,
          deviceAsrModelChunkMs: 2240,
          serverOwnedHistory: false,
          deviceAsrChunkDurationMs: chunk,
          deviceAsrEndpointMinSpeechMs: minSpeech,
          deviceAsrEndpointSilenceMs: silence,
        );
    final defaults = apple();
    expect(defaults.deviceAsrChunkDurationMs, 32);
    expect(defaults.deviceAsrEndpointMinSpeechMs, 96);
    expect(defaults.deviceAsrEndpointSilenceMs, 640);
    final custom = apple(chunk: 48, minSpeech: 512, silence: 768)
        .copyWith(sourceLanguage: 'ja');
    expect(custom.deviceAsrChunkDurationMs, 48);
    expect(custom.deviceAsrEndpointMinSpeechMs, 512);
    expect(custom.deviceAsrEndpointSilenceMs, 768);
  });
  test('normalizes realtime session language config', () {
    final config = AppConfig(
      apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
      useMockAudio: false,
      useDeviceAsr: true,
      sourceLanguage: 'bad-source',
      targetLanguage: 'EN',
      deviceAsrProvider: 'coreml_nemotron',
      deviceAsrLanguage: 'auto',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 2240,
      serverOwnedHistory: true,
    );

    expect(config.sourceLanguage, 'auto');
    expect(config.targetLanguage, 'en');
    expect(config.useLocalSessions, isFalse);
    expect(config.useOnDeviceTranslation, isFalse);
    expect(config.onDeviceTranslationProvider, 'ios_system');
    expect(config.onDeviceTranslationRequired, isFalse);
    expect(config.autoReverseTargetLanguage, isTrue);
    expect(config.deviceAsrChunkDurationMs, 320);
    expect(config.deviceAsrEndpointMinSpeechMs, 600);
    expect(config.deviceAsrEndpointSilenceMs, 900);
    expect(config.deviceAsrEndpointSpeechThresholdRms, 0.006);
    expect(config.deviceAsrVadProvider, 'fluidaudio_silero');
    expect(config.deviceAsrVadThreshold, 0.6);
    expect(config.deviceAsrVadNegativeThreshold, 0.35);
    expect(config.deviceAsrVadPreRollMs, 800);
    expect(config.deviceAsrDiagnosticCaptureEnabled, isFalse);
    expect(config.realtimeMode, 'conversation');
    expect(config.region.edition, RegionEdition.domestic);
    expect(config.region.allowedProviders, contains('hymt2_self_hosted'));
    expect(config.region.allowedProviders, contains('qwen_live'));
    expect(config.region.callProviderPolicy, 'call_link_only');
    expect(config.region.isPstnEnabled, isFalse);
    expect(config.appErrorReportingEnabled, isTrue);
    expect(config.appVersion, '0.1.0');
    expect(config.buildNumber, '1');
  });

  test('accepts Hy-MT language codes for realtime translation', () {
    final config = AppConfig(
      apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
      useMockAudio: false,
      useDeviceAsr: true,
      sourceLanguage: 'ZH-hant',
      targetLanguage: 'JA',
      autoReverseTargetLanguage: false,
      deviceAsrProvider: 'coreml_nemotron',
      deviceAsrLanguage: 'auto',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 2240,
      serverOwnedHistory: true,
    );

    expect(config.sourceLanguage, 'zh-Hant');
    expect(config.targetLanguage, 'ja');
    expect(config.autoReverseTargetLanguage, isFalse);
  });

  test('supports international edition overrides', () {
    final config = RegionEditionConfig.fromRaw(
      edition: 'international',
      dataRegion: 'ca',
      allowedProviders: 'openai, gemini',
      paymentStack: 'apple_iap, stripe',
    );

    expect(config.edition, RegionEdition.international);
    expect(config.defaultCountry, 'US');
    expect(config.dataRegion, 'ca');
    expect(config.allowedProviders, <String>['openai', 'gemini']);
    expect(config.paymentStack, <String>['apple_iap', 'stripe']);
    expect(config.callProviderPolicy, 'pstn_enabled');
    expect(config.isPstnEnabled, isTrue);
  });

  test('accepts domestic PSTN bridge policy as enabled', () {
    final config = RegionEditionConfig.fromRaw(
      edition: 'domestic',
      callProviderPolicy: 'domestic_pstn_bridge',
    );

    expect(config.isPstnEnabled, isTrue);
  });

  test('normalizes realtime mode overrides', () {
    final baseConfig = AppConfig(
      apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
      useMockAudio: false,
      useDeviceAsr: true,
      realtimeMode: 'classroom',
      deviceAsrProvider: 'coreml_nemotron',
      deviceAsrLanguage: 'auto',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 2240,
      serverOwnedHistory: true,
    );

    expect(baseConfig.realtimeMode, 'classroom');
    expect(
        baseConfig.copyWith(realtimeMode: 'bad').realtimeMode, 'conversation');
  });
}
