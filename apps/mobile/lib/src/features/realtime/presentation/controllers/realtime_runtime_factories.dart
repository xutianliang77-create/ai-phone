import '../../../../app/app_config.dart';
import '../../../../platform/audio/audio_capture.dart';
import '../../../../platform/audio/mock_audio_capture.dart';
import '../../../../platform/audio/record_audio_capture.dart';
import '../../../../platform/asr/android_system_asr_provider.dart';
import '../../../../platform/asr/core_ml_nemotron_asr_provider.dart';
import '../../../../platform/asr/mobile_asr_provider.dart';
import '../../../../platform/asr/unavailable_system_asr_provider.dart';
import '../../../../platform/translation/ios_system_translation_provider.dart';
import '../../../../platform/translation/mobile_translation_provider.dart';
import '../../../../platform/translation/phrasebook_translation_provider.dart';
import '../../../../platform/translation/supported_translation_language.dart';
import '../../../../platform/translation/unavailable_translation_provider.dart';
import '../../../history/data/local_session_store.dart';
import '../../data/local_realtime_repository.dart';
import '../../data/realtime_repository.dart';

AudioCapture createDefaultAudioCapture(AppConfig config) {
  if (config.useMockAudio) return MockAudioCapture();
  return RecordAudioCapture();
}

RealtimeRepository createDefaultRealtimeRepository(AppConfig config) {
  if (config.useLocalSessions) {
    return LocalRealtimeRepository(store: LocalSessionStore());
  }
  return RealtimeRepository.fromConfig(config);
}

MobileAsrProvider? createDefaultMobileAsrProvider(AppConfig config) {
  if (!config.useDeviceAsr) return null;
  if (config.deviceAsrProvider == 'coreml_nemotron') {
    return CoreMlNemotronAsrProvider();
  }
  if (config.deviceAsrProvider == 'android_system' ||
      config.deviceAsrProvider == 'system') {
    return AndroidSystemAsrProvider();
  }
  return UnavailableSystemAsrProvider();
}

MobileTranslationProvider? createDefaultMobileTranslationProvider(
  AppConfig config,
) {
  if (!config.useOnDeviceTranslation) return null;
  if (config.onDeviceTranslationProvider == 'phrasebook') {
    return PhrasebookTranslationProvider();
  }
  if (config.onDeviceTranslationProvider == 'ios_system') {
    return IosSystemTranslationProvider(
      fallback: config.useLocalSessions || config.onDeviceTranslationRequired
          ? null
          : PhrasebookTranslationProvider(),
    );
  }
  return UnavailableTranslationProvider();
}

MobileTranslationConfig createMobileTranslationConfig(AppConfig config) {
  return MobileTranslationConfig(
    sourceLanguage: config.sourceLanguage,
    targetLanguage: config.targetLanguage,
  );
}

List<MobileTranslationConfig> createOnDeviceTranslationPreflightConfigs(
  AppConfig config,
) {
  if (config.autoReverseTargetLanguage &&
      config.sourceLanguage == autoSourceLanguageCode) {
    return const <MobileTranslationConfig>[
      MobileTranslationConfig(sourceLanguage: 'en', targetLanguage: 'zh'),
      MobileTranslationConfig(sourceLanguage: 'zh', targetLanguage: 'en'),
    ];
  }
  if (config.sourceLanguage == autoSourceLanguageCode) {
    final sourceLanguage =
        isChineseFamilyLanguage(config.targetLanguage) ? 'en' : 'zh';
    return <MobileTranslationConfig>[
      MobileTranslationConfig(
        sourceLanguage: sourceLanguage,
        targetLanguage: config.targetLanguage,
      ),
    ];
  }
  return <MobileTranslationConfig>[createMobileTranslationConfig(config)];
}

MobileAsrConfig createDeviceAsrConfig(
  AppConfig config, {
  String? diagnosticSessionId,
}) {
  return MobileAsrConfig(
    language: config.deviceAsrLanguage,
    chunkDurationMs: config.deviceAsrChunkDurationMs,
    modelChunkMs: config.deviceAsrModelChunkMs,
    autoDownloadModel: config.deviceAsrAutoDownloadModel,
    endpointMinSpeechMs: config.deviceAsrEndpointMinSpeechMs,
    endpointSilenceMs: config.deviceAsrEndpointSilenceMs,
    endpointSpeechThresholdRms: config.deviceAsrEndpointSpeechThresholdRms,
    vadProvider: config.deviceAsrVadProvider,
    vadThreshold: config.deviceAsrVadThreshold,
    vadNegativeThreshold: config.deviceAsrVadNegativeThreshold,
    vadPreRollMs: config.deviceAsrVadPreRollMs,
    turnRoutingPolicy:
        config.realtimeMode == 'conversation' ? 'alternate' : 'sticky',
    diagnosticCaptureEnabled: config.deviceAsrDiagnosticCaptureEnabled,
    diagnosticSessionId: diagnosticSessionId,
  );
}
