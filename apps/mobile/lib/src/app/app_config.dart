import 'region_edition_config.dart';
import '../platform/translation/supported_translation_language.dart';

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
    this.appVersion = '0.1.0',
    this.buildNumber = '1',
    this.deviceAsrChunkDurationMs = 320,
    this.deviceAsrEndpointMinSpeechMs = 600,
    this.deviceAsrEndpointSilenceMs = 900,
    this.deviceAsrEndpointSpeechThresholdRms = 0.006,
    this.useLocalSessions = false,
    this.useOnDeviceTranslation = false,
    this.onDeviceTranslationProvider = 'ios_system',
    this.onDeviceTranslationRequired = false,
    this.autoReverseTargetLanguage = true,
    String realtimeVoiceOutputMode = 'off',
    RegionEditionConfig? region,
    String realtimeMode = 'conversation',
    String sourceLanguage = 'auto',
    String targetLanguage = 'zh',
  })  : realtimeVoiceOutputMode =
            _normalizeRealtimeVoiceOutputMode(realtimeVoiceOutputMode),
        sourceLanguage = _normalizeSourceLanguage(sourceLanguage),
        targetLanguage = _normalizeTargetLanguage(targetLanguage),
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
  final bool useLocalSessions;
  final bool useOnDeviceTranslation;
  final String onDeviceTranslationProvider;
  final bool onDeviceTranslationRequired;
  final bool autoReverseTargetLanguage;
  final String realtimeVoiceOutputMode;
  final bool serverOwnedHistory;
  final bool appErrorReportingEnabled;
  final String appVersion;
  final String buildNumber;
  final RegionEditionConfig region;

  static AppConfig fromEnvironment() {
    final region = RegionEditionConfig.fromEnvironment();
    const apiBaseUrl = String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: 'http://127.0.0.1:3100',
    );
    const useMockAudio = bool.fromEnvironment('USE_MOCK_AUDIO');
    const useDeviceAsr = bool.fromEnvironment('USE_DEVICE_ASR');
    const sourceLanguage = String.fromEnvironment(
      'SOURCE_LANGUAGE',
      defaultValue: 'auto',
    );
    const realtimeMode = String.fromEnvironment(
      'REALTIME_MODE',
      defaultValue: 'conversation',
    );
    const targetLanguage = String.fromEnvironment(
      'TARGET_LANGUAGE',
      defaultValue: 'zh',
    );
    const autoReverseTargetLanguage = bool.fromEnvironment(
      'AUTO_REVERSE_TARGET_LANGUAGE',
      defaultValue: true,
    );
    const deviceAsrProvider = String.fromEnvironment(
      'DEVICE_ASR_PROVIDER',
      defaultValue: 'coreml_nemotron',
    );
    const deviceAsrLanguage = String.fromEnvironment(
      'DEVICE_ASR_LANGUAGE',
      defaultValue: 'auto',
    );
    const deviceAsrAutoDownloadModel = bool.fromEnvironment(
      'DEVICE_ASR_AUTO_DOWNLOAD_MODEL',
    );
    const deviceAsrModelChunkMs = int.fromEnvironment(
      'DEVICE_ASR_MODEL_CHUNK_MS',
      defaultValue: 2240,
    );
    const deviceAsrChunkDurationMs = int.fromEnvironment(
      'DEVICE_ASR_CHUNK_DURATION_MS',
      defaultValue: 320,
    );
    const deviceAsrEndpointMinSpeechMs = int.fromEnvironment(
      'DEVICE_ASR_ENDPOINT_MIN_SPEECH_MS',
      defaultValue: 600,
    );
    const deviceAsrEndpointSilenceMs = int.fromEnvironment(
      'DEVICE_ASR_ENDPOINT_SILENCE_MS',
      defaultValue: 900,
    );
    const deviceAsrEndpointSpeechThresholdRmsRaw = String.fromEnvironment(
      'DEVICE_ASR_ENDPOINT_SPEECH_THRESHOLD_RMS',
      defaultValue: '0.006',
    );
    final deviceAsrEndpointSpeechThresholdRms =
        double.tryParse(deviceAsrEndpointSpeechThresholdRmsRaw) ?? 0.006;
    const useOnDeviceTranslation =
        bool.fromEnvironment('USE_ON_DEVICE_TRANSLATION');
    const useLocalSessions = bool.fromEnvironment('USE_LOCAL_SESSIONS');
    const onDeviceTranslationProvider = String.fromEnvironment(
      'ON_DEVICE_TRANSLATION_PROVIDER',
      defaultValue: 'ios_system',
    );
    const onDeviceTranslationRequired =
        bool.fromEnvironment('ON_DEVICE_TRANSLATION_REQUIRED');
    const serverOwnedHistory = bool.fromEnvironment('SERVER_OWNED_HISTORY');
    const appErrorReportingEnabled = bool.fromEnvironment(
      'APP_ERROR_REPORTING_ENABLED',
      defaultValue: true,
    );
    const realtimeVoiceOutputMode = String.fromEnvironment(
      'REALTIME_VOICE_OUTPUT_MODE',
      defaultValue: 'off',
    );
    const appVersion = String.fromEnvironment(
      'APP_VERSION',
      defaultValue: '0.1.0',
    );
    const buildNumber = String.fromEnvironment(
      'BUILD_NUMBER',
      defaultValue: '1',
    );
    return AppConfig(
      apiBaseUrl: Uri.parse(apiBaseUrl),
      useMockAudio: useMockAudio,
      useDeviceAsr: useDeviceAsr,
      realtimeMode: realtimeMode,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      deviceAsrProvider: deviceAsrProvider,
      deviceAsrLanguage: deviceAsrLanguage,
      deviceAsrAutoDownloadModel: deviceAsrAutoDownloadModel,
      deviceAsrModelChunkMs: deviceAsrModelChunkMs,
      deviceAsrChunkDurationMs: deviceAsrChunkDurationMs,
      deviceAsrEndpointMinSpeechMs: deviceAsrEndpointMinSpeechMs,
      deviceAsrEndpointSilenceMs: deviceAsrEndpointSilenceMs,
      deviceAsrEndpointSpeechThresholdRms: deviceAsrEndpointSpeechThresholdRms,
      useLocalSessions: useLocalSessions,
      useOnDeviceTranslation: useOnDeviceTranslation,
      onDeviceTranslationProvider: onDeviceTranslationProvider,
      onDeviceTranslationRequired: onDeviceTranslationRequired,
      autoReverseTargetLanguage: autoReverseTargetLanguage ||
          targetLanguage == autoReverseTargetLanguageCode,
      realtimeVoiceOutputMode: realtimeVoiceOutputMode,
      serverOwnedHistory: serverOwnedHistory,
      appErrorReportingEnabled: appErrorReportingEnabled,
      appVersion: appVersion,
      buildNumber: buildNumber,
      region: region,
    );
  }

  AppConfig copyWith({
    String? realtimeMode,
    String? sourceLanguage,
    String? targetLanguage,
    bool? useDeviceAsr,
    bool? useLocalSessions,
    bool? useOnDeviceTranslation,
    bool? autoReverseTargetLanguage,
    String? realtimeVoiceOutputMode,
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
      useLocalSessions: useLocalSessions ?? this.useLocalSessions,
      useOnDeviceTranslation:
          useOnDeviceTranslation ?? this.useOnDeviceTranslation,
      onDeviceTranslationProvider: onDeviceTranslationProvider,
      onDeviceTranslationRequired: onDeviceTranslationRequired,
      autoReverseTargetLanguage:
          autoReverseTargetLanguage ?? this.autoReverseTargetLanguage,
      realtimeVoiceOutputMode:
          realtimeVoiceOutputMode ?? this.realtimeVoiceOutputMode,
      serverOwnedHistory: serverOwnedHistory,
      appErrorReportingEnabled: appErrorReportingEnabled,
      appVersion: appVersion,
      buildNumber: buildNumber,
      region: region,
    );
  }
}

String _normalizeRealtimeVoiceOutputMode(String value) {
  final mode = value.trim().toLowerCase();
  if (mode == 'natural' || mode == 'my_voice') return mode;
  return 'off';
}

String _normalizeSourceLanguage(String value) {
  return normalizeSourceLanguageCode(value);
}

String _normalizeTargetLanguage(String value) {
  return normalizeTargetLanguageCode(value);
}

String _normalizeRealtimeMode(String value) {
  final mode = value.trim().toLowerCase();
  if (mode == 'meeting' || mode == 'classroom' || mode == 'business') {
    return mode;
  }
  return 'conversation';
}
