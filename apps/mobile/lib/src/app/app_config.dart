import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform;

import 'region_edition_config.dart';
import '../platform/translation/supported_translation_language.dart';
import '../platform/translation/translation_language_pair.dart';
import '../features/realtime/data/voice_preset_catalog.dart';
import '../features/realtime/data/domain_lexicon_pack.dart';

part 'app_config_environment.dart';

class AppConfig {
  AppConfig({
    required this.apiBaseUrl,
    required this.useMockAudio,
    required this.useDeviceAsr,
    required this.deviceAsrProvider,
    required this.deviceAsrLanguage,
    required this.deviceAsrAutoDownloadModel,
    required this.deviceAsrModelChunkMs,
    required this.serverOwnedHistory,
    this.appErrorReportingEnabled = true,
    this.voiceAgentBackgroundWorkEnabled = false,
    this.voiceAgentOwnershipEnabled = false,
    this.voiceAgentDeliveryCoordinatorEnabled = false,
    this.appVersion = '0.1.0',
    this.buildNumber = '1',
    int? deviceAsrChunkDurationMs,
    int? deviceAsrEndpointMinSpeechMs,
    int? deviceAsrEndpointSilenceMs,
    this.deviceAsrEndpointSpeechThresholdRms = 0.006,
    this.deviceAsrVadProvider = 'fluidaudio_silero',
    this.deviceAsrVadThreshold = 0.6,
    this.deviceAsrVadNegativeThreshold = 0.35,
    this.deviceAsrVadPreRollMs = 800,
    this.deviceAsrDiagnosticCaptureEnabled = false,
    this.useLocalSessions = false,
    this.useOnDeviceTranslation = false,
    bool? preferDeviceAsrOnline,
    bool? preferOnDeviceTranslationOnline,
    this.onDeviceTranslationProvider = 'ios_system',
    this.onDeviceTranslationRequired = false,
    this.autoReverseTargetLanguage = true,
    this.automaticLanguagePair,
    String realtimeVoiceOutputMode = 'off',
    String realtimeVoicePresetId = defaultRealtimeVoicePresetId,
    String domainLexiconPack = defaultDomainLexiconPack,
    RegionEditionConfig? region,
    String realtimeMode = 'conversation',
    String sourceLanguage = 'auto',
    String targetLanguage = 'zh',
  })  : deviceAsrChunkDurationMs = deviceAsrChunkDurationMs ??
            (deviceAsrProvider == 'apple_speech_transcriber' ? 32 : 320),
        deviceAsrEndpointMinSpeechMs = deviceAsrEndpointMinSpeechMs ??
            (deviceAsrProvider == 'apple_speech_transcriber' ? 96 : 600),
        deviceAsrEndpointSilenceMs = deviceAsrEndpointSilenceMs ??
            (deviceAsrProvider == 'apple_speech_transcriber' ? 640 : 900),
        preferDeviceAsrOnline = preferDeviceAsrOnline ?? useDeviceAsr,
        preferOnDeviceTranslationOnline =
            preferOnDeviceTranslationOnline ?? useOnDeviceTranslation,
        realtimeVoiceOutputMode =
            _normalizeRealtimeVoiceOutputMode(realtimeVoiceOutputMode),
        sourceLanguage = normalizeSourceLanguageCode(sourceLanguage),
        realtimeVoicePresetId = _normalizeVoicePresetId(realtimeVoicePresetId),
        domainLexiconPack = normalizeDomainLexiconPack(domainLexiconPack),
        targetLanguage = normalizeTargetLanguageCode(targetLanguage),
        realtimeMode = _normalizeRealtimeMode(realtimeMode),
        region = region ?? const RegionEditionConfig.domestic();
  final Uri apiBaseUrl;
  final bool useMockAudio;
  final bool useDeviceAsr;
  final String realtimeMode;
  final String sourceLanguage;
  final String targetLanguage;
  final String deviceAsrProvider;
  final String deviceAsrLanguage;
  final bool deviceAsrAutoDownloadModel;
  final int deviceAsrModelChunkMs;
  final int deviceAsrChunkDurationMs;
  final int deviceAsrEndpointMinSpeechMs;
  final int deviceAsrEndpointSilenceMs;
  final double deviceAsrEndpointSpeechThresholdRms;
  final String deviceAsrVadProvider;
  final double deviceAsrVadThreshold;
  final double deviceAsrVadNegativeThreshold;
  final int deviceAsrVadPreRollMs;
  final bool deviceAsrDiagnosticCaptureEnabled;
  final bool useLocalSessions;
  final bool useOnDeviceTranslation;
  // Legacy r6 preferences; online mode ignores them (r6.1).
  final bool preferDeviceAsrOnline;
  final bool preferOnDeviceTranslationOnline;
  final String onDeviceTranslationProvider;
  final bool onDeviceTranslationRequired;
  final bool autoReverseTargetLanguage;
  final TranslationLanguagePair? automaticLanguagePair;
  final String realtimeVoiceOutputMode;
  final String realtimeVoicePresetId;
  final String domainLexiconPack;
  final bool serverOwnedHistory;
  final bool appErrorReportingEnabled;
  final bool voiceAgentBackgroundWorkEnabled;
  final bool voiceAgentOwnershipEnabled;
  final bool voiceAgentDeliveryCoordinatorEnabled;
  final String appVersion;
  final String buildNumber;
  final RegionEditionConfig region;
  static AppConfig fromEnvironment() => _appConfigFromEnvironment();

  AppConfig copyWith({
    String? realtimeMode,
    String? sourceLanguage,
    String? targetLanguage,
    bool? useDeviceAsr,
    bool? useLocalSessions,
    bool? useOnDeviceTranslation,
    String? onDeviceTranslationProvider,
    bool? autoReverseTargetLanguage,
    TranslationLanguagePair? automaticLanguagePair,
    bool clearAutomaticLanguagePair = false,
    String? realtimeVoiceOutputMode,
    String? realtimeVoicePresetId,
    String? domainLexiconPack,
  }) {
    return AppConfig(
      apiBaseUrl: apiBaseUrl,
      useMockAudio: useMockAudio,
      useDeviceAsr: useDeviceAsr ?? this.useDeviceAsr,
      realtimeMode: realtimeMode ?? this.realtimeMode,
      sourceLanguage: sourceLanguage ?? this.sourceLanguage,
      targetLanguage: targetLanguage ?? this.targetLanguage,
      deviceAsrProvider: deviceAsrProvider,
      deviceAsrLanguage: deviceAsrLanguage,
      deviceAsrAutoDownloadModel: deviceAsrAutoDownloadModel,
      deviceAsrModelChunkMs: deviceAsrModelChunkMs,
      deviceAsrChunkDurationMs: deviceAsrChunkDurationMs,
      deviceAsrEndpointMinSpeechMs: deviceAsrEndpointMinSpeechMs,
      deviceAsrEndpointSilenceMs: deviceAsrEndpointSilenceMs,
      deviceAsrEndpointSpeechThresholdRms: deviceAsrEndpointSpeechThresholdRms,
      deviceAsrVadProvider: deviceAsrVadProvider,
      deviceAsrVadThreshold: deviceAsrVadThreshold,
      deviceAsrVadNegativeThreshold: deviceAsrVadNegativeThreshold,
      deviceAsrVadPreRollMs: deviceAsrVadPreRollMs,
      deviceAsrDiagnosticCaptureEnabled: deviceAsrDiagnosticCaptureEnabled,
      useLocalSessions: useLocalSessions ?? this.useLocalSessions,
      useOnDeviceTranslation:
          useOnDeviceTranslation ?? this.useOnDeviceTranslation,
      preferDeviceAsrOnline: preferDeviceAsrOnline,
      preferOnDeviceTranslationOnline: preferOnDeviceTranslationOnline,
      onDeviceTranslationProvider:
          onDeviceTranslationProvider ?? this.onDeviceTranslationProvider,
      onDeviceTranslationRequired: onDeviceTranslationRequired,
      autoReverseTargetLanguage:
          autoReverseTargetLanguage ?? this.autoReverseTargetLanguage,
      automaticLanguagePair: clearAutomaticLanguagePair
          ? null
          : automaticLanguagePair ?? this.automaticLanguagePair,
      realtimeVoiceOutputMode:
          realtimeVoiceOutputMode ?? this.realtimeVoiceOutputMode,
      realtimeVoicePresetId:
          realtimeVoicePresetId ?? this.realtimeVoicePresetId,
      domainLexiconPack: domainLexiconPack ?? this.domainLexiconPack,
      serverOwnedHistory: serverOwnedHistory,
      appErrorReportingEnabled: appErrorReportingEnabled,
      voiceAgentBackgroundWorkEnabled: voiceAgentBackgroundWorkEnabled,
      voiceAgentOwnershipEnabled: voiceAgentOwnershipEnabled,
      voiceAgentDeliveryCoordinatorEnabled:
          voiceAgentDeliveryCoordinatorEnabled,
      appVersion: appVersion,
      buildNumber: buildNumber,
      region: region,
    );
  }
}

TranslationLanguagePair? _automaticLanguagePairFromEnvironment(String raw) {
  final values = raw.split(',').map((value) => value.trim()).toList();
  if (values.length != 2) return null;
  return TranslationLanguagePair.fromLanguages(values[0], values[1]);
}

String _normalizeVoicePresetId(String value) {
  final cleaned = value.trim();
  return RegExp(r'^[A-Za-z0-9_-]{1,80}$').hasMatch(cleaned)
      ? cleaned
      : defaultRealtimeVoicePresetId;
}

String _normalizeRealtimeVoiceOutputMode(String value) {
  final mode = value.trim().toLowerCase();
  if (mode == 'natural' || mode == 'my_voice') return mode;
  return 'off';
}

String _normalizeRealtimeMode(String value) {
  final mode = value.trim().toLowerCase();
  if (mode == 'meeting' || mode == 'classroom' || mode == 'business') {
    return mode;
  }
  return 'conversation';
}

String _platformDefaultDeviceAsrProvider() =>
    defaultTargetPlatform == TargetPlatform.android
        ? 'android_system'
        : defaultTargetPlatform == TargetPlatform.iOS
            ? 'apple_speech_transcriber'
            : 'coreml_nemotron';

String _platformDefaultTranslationProvider() =>
    defaultTargetPlatform == TargetPlatform.android
        ? 'android_mlkit'
        : 'ios_system';

String _platformDefaultVadProvider() =>
    defaultTargetPlatform == TargetPlatform.android
        ? 'silero_onnx'
        : 'fluidaudio_silero';
