part of 'app_config.dart';

AppConfig _appConfigFromEnvironment() {
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
  const automaticLanguagePair = String.fromEnvironment(
    'AUTOMATIC_LANGUAGE_PAIR',
  );
  const configuredDeviceAsrProvider = String.fromEnvironment(
    'DEVICE_ASR_PROVIDER',
  );
  final deviceAsrProvider = configuredDeviceAsrProvider.isEmpty
      ? _platformDefaultDeviceAsrProvider()
      : configuredDeviceAsrProvider;
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
  const configuredDeviceAsrChunkDurationMs = int.fromEnvironment(
    'DEVICE_ASR_CHUNK_DURATION_MS',
    defaultValue: 0,
  );
  final deviceAsrChunkDurationMs = configuredDeviceAsrChunkDurationMs > 0
      ? configuredDeviceAsrChunkDurationMs
      : deviceAsrProvider == 'apple_speech_transcriber'
          ? 32
          : 320;
  const configuredDeviceAsrEndpointMinSpeechMs = int.fromEnvironment(
    'DEVICE_ASR_ENDPOINT_MIN_SPEECH_MS',
    defaultValue: 0,
  );
  final deviceAsrEndpointMinSpeechMs =
      configuredDeviceAsrEndpointMinSpeechMs > 0
          ? configuredDeviceAsrEndpointMinSpeechMs
          : deviceAsrProvider == 'apple_speech_transcriber'
              ? 96
              : 600;
  const configuredDeviceAsrEndpointSilenceMs = int.fromEnvironment(
    'DEVICE_ASR_ENDPOINT_SILENCE_MS',
    defaultValue: 0,
  );
  final deviceAsrEndpointSilenceMs = configuredDeviceAsrEndpointSilenceMs > 0
      ? configuredDeviceAsrEndpointSilenceMs
      : deviceAsrProvider == 'apple_speech_transcriber'
          ? 640
          : 900;
  const deviceAsrEndpointSpeechThresholdRmsRaw = String.fromEnvironment(
    'DEVICE_ASR_ENDPOINT_SPEECH_THRESHOLD_RMS',
    defaultValue: '0.006',
  );
  final deviceAsrEndpointSpeechThresholdRms =
      double.tryParse(deviceAsrEndpointSpeechThresholdRmsRaw) ?? 0.006;
  const configuredDeviceAsrVadProvider = String.fromEnvironment(
    'DEVICE_ASR_VAD_PROVIDER',
  );
  final deviceAsrVadProvider = configuredDeviceAsrVadProvider.isEmpty
      ? _platformDefaultVadProvider()
      : configuredDeviceAsrVadProvider;
  const deviceAsrVadThresholdRaw = String.fromEnvironment(
    'DEVICE_ASR_VAD_THRESHOLD',
    defaultValue: '0.6',
  );
  final deviceAsrVadThreshold =
      double.tryParse(deviceAsrVadThresholdRaw) ?? 0.6;
  const deviceAsrVadNegativeThresholdRaw = String.fromEnvironment(
    'DEVICE_ASR_VAD_NEGATIVE_THRESHOLD',
    defaultValue: '0.35',
  );
  final deviceAsrVadNegativeThreshold =
      double.tryParse(deviceAsrVadNegativeThresholdRaw) ?? 0.35;
  const deviceAsrVadPreRollMs = int.fromEnvironment(
    'DEVICE_ASR_VAD_PRE_ROLL_MS',
    defaultValue: 800,
  );
  const deviceAsrDiagnosticCaptureEnabled = bool.fromEnvironment(
    'DEVICE_ASR_DIAGNOSTIC_CAPTURE',
  );
  const useOnDeviceTranslation =
      bool.fromEnvironment('USE_ON_DEVICE_TRANSLATION');
  const useLocalSessions = bool.fromEnvironment('USE_LOCAL_SESSIONS');
  const configuredOnDeviceTranslationProvider = String.fromEnvironment(
    'ON_DEVICE_TRANSLATION_PROVIDER',
  );
  final onDeviceTranslationProvider =
      configuredOnDeviceTranslationProvider.isEmpty
          ? _platformDefaultTranslationProvider()
          : configuredOnDeviceTranslationProvider;
  const onDeviceTranslationRequired =
      bool.fromEnvironment('ON_DEVICE_TRANSLATION_REQUIRED');
  const serverOwnedHistory = bool.fromEnvironment('SERVER_OWNED_HISTORY');
  const appErrorReportingEnabled = bool.fromEnvironment(
    'APP_ERROR_REPORTING_ENABLED',
    defaultValue: true,
  );
  const voiceAgentBackgroundWorkEnabled = bool.fromEnvironment(
    'VOICE_AGENT_BACKGROUND_WORK_ENABLED',
  );
  const voiceAgentOwnershipEnabled = bool.fromEnvironment(
    'VOICE_AGENT_OWNERSHIP_ENABLED',
  );
  const voiceAgentDeliveryCoordinatorEnabled = bool.fromEnvironment(
    'VOICE_AGENT_DELIVERY_COORDINATOR_ENABLED',
  );
  const realtimeVoiceOutputMode = String.fromEnvironment(
    'REALTIME_VOICE_OUTPUT_MODE',
    defaultValue: 'natural',
  );
  const realtimeVoicePresetId = String.fromEnvironment(
    'REALTIME_VOICE_PRESET_ID',
    defaultValue: defaultRealtimeVoicePresetId,
  );
  const domainLexiconPack = String.fromEnvironment(
    'DOMAIN_LEXICON_PACK',
    defaultValue: defaultDomainLexiconPack,
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
    deviceAsrVadProvider: deviceAsrVadProvider,
    deviceAsrVadThreshold: deviceAsrVadThreshold,
    deviceAsrVadNegativeThreshold: deviceAsrVadNegativeThreshold,
    deviceAsrVadPreRollMs: deviceAsrVadPreRollMs,
    deviceAsrDiagnosticCaptureEnabled: deviceAsrDiagnosticCaptureEnabled,
    useLocalSessions: useLocalSessions,
    useOnDeviceTranslation: useOnDeviceTranslation,
    onDeviceTranslationProvider: onDeviceTranslationProvider,
    onDeviceTranslationRequired: onDeviceTranslationRequired,
    autoReverseTargetLanguage: autoReverseTargetLanguage ||
        targetLanguage == autoReverseTargetLanguageCode,
    automaticLanguagePair:
        _automaticLanguagePairFromEnvironment(automaticLanguagePair),
    realtimeVoiceOutputMode: realtimeVoiceOutputMode,
    realtimeVoicePresetId: realtimeVoicePresetId,
    domainLexiconPack: domainLexiconPack,
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
