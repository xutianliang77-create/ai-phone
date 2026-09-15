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
import '../../../../platform/translation/android_on_device_translation_provider.dart';
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
  // r6.1: the mode, not a stale legacy flag, decides model placement.
  if (!config.useLocalSessions || !config.useDeviceAsr) return null;
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
  if (!config.useLocalSessions || !config.useOnDeviceTranslation) return null;
  return createDefaultAuxiliaryMobileTranslationProvider(config);
}

/// OCR and type-to-speak are inherited phone-side tools, not realtime cloud
/// inference.  They keep their device OCR/MT/TTS path even in the public app;
/// saving the already-produced result may still use the normal 1.1 history
/// repository, but this factory never selects a server translation provider.
MobileTranslationProvider createDefaultAuxiliaryMobileTranslationProvider(
  AppConfig config,
) {
  if (config.onDeviceTranslationProvider == 'phrasebook') {
    return PhrasebookTranslationProvider();
  }
  if (config.onDeviceTranslationProvider == 'android_mlkit') {
    return AndroidOnDeviceTranslationProvider();
  }
  if (config.onDeviceTranslationProvider == 'ios_system') {
    return IosSystemTranslationProvider(
      // Auxiliary entry points must not silently substitute a phrasebook for
      // the selected system model.  If the local language pair is absent, the
      // existing resource/error path explains that state to the user.
      fallback: null,
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
    // An automatic setting without the user's saved A/B pair is not a
    // license to silently substitute a Chinese/English route. The caller
    // keeps the preference and reports the missing resource/qualification.
    return const <MobileTranslationConfig>[];
  }
  if (config.sourceLanguage == autoSourceLanguageCode) {
    return const <MobileTranslationConfig>[];
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
  final androidSystem = config.deviceAsrProvider == 'android_system' ||
      config.deviceAsrProvider == 'system';
  return MobileAsrConfig(
    // Both system recognizers receive the language the user actually selected.
    // `DEVICE_ASR_LANGUAGE` remains only for an explicitly configured custom
    // model; it must not leave Android at `auto` after a fixed local setting.
    language: appleSpeech || androidSystem
        ? config.sourceLanguage
        : config.deviceAsrLanguage,
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
