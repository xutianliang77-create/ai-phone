import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/platform/translation/supported_translation_language.dart';

void main() {
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
    expect(settings.toJson()['voiceOutputMode'], 'natural');
  });
}

AppConfig _baseConfig() {
  return AppConfig(
    apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
    useMockAudio: false,
    useDeviceAsr: false,
    autoReverseTargetLanguage: false,
    deviceAsrProvider: 'coreml_nemotron',
    deviceAsrLanguage: 'auto',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    serverOwnedHistory: true,
  );
}
