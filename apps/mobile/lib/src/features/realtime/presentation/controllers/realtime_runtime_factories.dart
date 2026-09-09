import '../../../../app/app_config.dart';
import '../../../../platform/audio/audio_capture.dart';
import '../../../../platform/audio/mock_audio_capture.dart';
import '../../../../platform/audio/record_audio_capture.dart';
import '../../../../platform/asr/android_system_asr_provider.dart';
import '../../../../platform/asr/apple_speech_asr_provider.dart';
import '../../../../platform/asr/core_ml_nemotron_asr_provider.dart';
import '../../../../platform/asr/mobile_asr_provider.dart';
import '../../../../platform/asr/unavailable_system_asr_provider.dart';
import '../../../../platform/translation/ios_system_translation_provider.dart';
import '../../../../platform/translation/mobile_translation_provider.dart';
import '../../../../platform/translation/phrasebook_translation_provider.dart';
import '../../../../platform/translation/supported_translation_language.dart';
import '../../../../platform/translation/translation_language_pair.dart';
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
  if (config.deviceAsrProvider == 'apple_speech_transcriber') {
    return AppleSpeechAsrProvider();
  }
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
  if (config.deviceAsrProvider == 'apple_speech_transcriber') {
    if (config.autoReverseTargetLanguage) {
      final pair = explicitRealtimeLanguagePair(config);
      return pair == null
          ? const []
          : [
              MobileTranslationConfig(
                  sourceLanguage: pair.source, targetLanguage: pair.target),
              MobileTranslationConfig(
                  sourceLanguage: pair.target, targetLanguage: pair.source),
            ];
    }
    final source = canonicalTranslationLanguageCode(config.sourceLanguage);
    final target = canonicalTranslationLanguageCode(config.targetLanguage);
    // Automatic source with a fixed target is checked per actual final segment.
    return source == null || target == null || source == target
        ? const []
        : [
            MobileTranslationConfig(
                sourceLanguage: source, targetLanguage: target)
          ];
  }
  final pair = config.automaticLanguagePair;
  if (config.autoReverseTargetLanguage && pair != null) {
    return [
      MobileTranslationConfig(
          sourceLanguage: pair.source, targetLanguage: pair.target),
      MobileTranslationConfig(
          sourceLanguage: pair.target, targetLanguage: pair.source),
    ];
  }
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

/// Reuse the user's stored pair or two explicit fields, never an implicit zh/en pair.
TranslationLanguagePair? explicitRealtimeLanguagePair(AppConfig config) {
  final saved = config.automaticLanguagePair;
  if (saved != null) {
    final valid =
        TranslationLanguagePair.fromLanguages(saved.source, saved.target);
    if (valid == null ||
        valid.opposite(config.targetLanguage) == null ||
        (config.sourceLanguage != autoSourceLanguageCode &&
            valid.opposite(config.sourceLanguage) == null)) {
      return null;
    }
    return valid;
  }
  return TranslationLanguagePair.fromLanguages(
      config.sourceLanguage, config.targetLanguage);
}

MobileAsrConfig createDeviceAsrConfig(
  AppConfig config, {
  bool? autoDownloadModel,
  String? diagnosticSessionId,
  String? captureId,
  String? languagePolicyKey,
}) {
  final appleSpeech = config.deviceAsrProvider == 'apple_speech_transcriber';
  return MobileAsrConfig(
    language: appleSpeech ? config.sourceLanguage : config.deviceAsrLanguage,
    chunkDurationMs: config.deviceAsrChunkDurationMs,
    modelChunkMs: config.deviceAsrModelChunkMs,
    autoDownloadModel: autoDownloadModel ?? config.deviceAsrAutoDownloadModel,
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
    captureId: captureId,
    languagePolicyKey: languagePolicyKey,
  );
}
