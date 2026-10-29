import 'region_edition_config.dart';
import 'app_release_environment.dart';
import 'app_config_normalization.dart';
import '../platform/translation/supported_translation_language.dart'
    show autoReverseTargetLanguageCode;
import '../features/realtime/data/voice_preset_catalog.dart';
import '../features/realtime/data/domain_lexicon_pack.dart';
part 'app_config_environment.dart';

class AppConfig {
  AppConfig({
    required this.apiBaseUrl,
    this.executionMode = 'server',
    required this.useMockAudio,
    required this.useDeviceAsr,
    required this.deviceAsrProvider,
    required this.deviceAsrLanguage,
    required this.deviceAsrAutoDownloadModel,
    required this.deviceAsrModelChunkMs,
    required this.serverOwnedHistory,
    this.distributionChannel = 'restricted_instance',
    this.productProfile = 'full',
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
    this.onDeviceTranslationProvider = 'ios_system',
    this.onDeviceTranslationRequired = false,
    this.autoReverseTargetLanguage = true,
    String realtimeVoiceOutputMode = 'off',
    String realtimeVoicePresetId = defaultRealtimeVoicePresetId,
    String domainLexiconPack = defaultDomainLexiconPack,
    RegionEditionConfig? region,
    String realtimeMode = 'conversation',
    String sourceLanguage = 'auto',
    String targetLanguage = 'zh',
    this.automaticPairA = 'zh',
    this.automaticPairB = 'en',
  }) : deviceAsrChunkDurationMs =
           deviceAsrChunkDurationMs ??
           (deviceAsrProvider == 'apple_speech_transcriber' ? 32 : 320),
       deviceAsrEndpointMinSpeechMs =
           deviceAsrEndpointMinSpeechMs ??
           (deviceAsrProvider == 'apple_speech_transcriber' ? 96 : 600),
       deviceAsrEndpointSilenceMs =
           deviceAsrEndpointSilenceMs ??
           (deviceAsrProvider == 'apple_speech_transcriber' ? 640 : 900),
       realtimeVoiceOutputMode = normalizeConfigRealtimeVoiceOutputMode(
         realtimeVoiceOutputMode,
       ),
       sourceLanguage = normalizeConfigSourceLanguage(sourceLanguage),
       realtimeVoicePresetId = normalizeConfigVoicePresetId(
         realtimeVoicePresetId,
       ),
       domainLexiconPack = normalizeDomainLexiconPack(domainLexiconPack),
       targetLanguage = normalizeConfigTargetLanguage(targetLanguage),
       realtimeMode = normalizeConfigRealtimeMode(realtimeMode),
       region = region ?? const RegionEditionConfig.domestic() {
    validateAppReleaseEnvironment(
      executionMode: executionMode,
      channel: distributionChannel,
      apiBaseUrl: apiBaseUrl,
      productProfile: productProfile,
      useMockAudio: useMockAudio,
      useDeviceAsr: useDeviceAsr,
      useLocalSessions: useLocalSessions,
      useOnDeviceTranslation: useOnDeviceTranslation,
      serverOwnedHistory: serverOwnedHistory,
      deviceAsrProvider: deviceAsrProvider,
      translationProvider: onDeviceTranslationProvider,
      translationRequired: onDeviceTranslationRequired,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      voiceOutputMode: this.realtimeVoiceOutputMode,
    );
  }
  final Uri apiBaseUrl;
  final String executionMode;
  bool get onDeviceOnly => executionMode == 'on_device';
  Uri get accountApiBaseUrl {
    const control = String.fromEnvironment('CONTROL_API_BASE_URL');
    return control.isEmpty ? apiBaseUrl : Uri.parse(control);
  }

  final String distributionChannel;
  final String productProfile;
  bool get isFormalRelease => distributionChannel == 'app_store';
  final bool useMockAudio;
  final bool useDeviceAsr;
  final String realtimeMode;
  final String sourceLanguage;
  final String targetLanguage;
  final String automaticPairA;
  final String automaticPairB;
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
  final String onDeviceTranslationProvider;
  final bool onDeviceTranslationRequired;
  final bool autoReverseTargetLanguage;
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
  static AppConfig fromEnvironment() => _readAppConfigEnvironment();
  AppConfig copyWith({
    String? realtimeMode,
    String? sourceLanguage,
    String? targetLanguage,
    String? automaticPairA,
    String? automaticPairB,
    bool? useDeviceAsr,
    bool? useLocalSessions,
    bool? useOnDeviceTranslation,
    bool? autoReverseTargetLanguage,
    String? realtimeVoiceOutputMode,
    String? realtimeVoicePresetId,
    String? domainLexiconPack,
  }) {
    return AppConfig(
      executionMode: executionMode,
      distributionChannel: distributionChannel,
      productProfile: productProfile,
      apiBaseUrl: apiBaseUrl,
      useMockAudio: useMockAudio,
      useDeviceAsr: useDeviceAsr ?? this.useDeviceAsr,
      realtimeMode: realtimeMode ?? this.realtimeMode,
      sourceLanguage: sourceLanguage ?? this.sourceLanguage,
      targetLanguage: targetLanguage ?? this.targetLanguage,
      automaticPairA: automaticPairA ?? this.automaticPairA,
      automaticPairB: automaticPairB ?? this.automaticPairB,
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
      onDeviceTranslationProvider: onDeviceTranslationProvider,
      onDeviceTranslationRequired: onDeviceTranslationRequired,
      autoReverseTargetLanguage:
          autoReverseTargetLanguage ?? this.autoReverseTargetLanguage,
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
