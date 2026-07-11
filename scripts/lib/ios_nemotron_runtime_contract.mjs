export const iosNemotronRequiredRuntimeContract = Object.freeze({
  deviceAsrProvider: "coreml_nemotron",
  modelChunkMs: 2240,
  autoDownloadModel: false,
  sourceLanguage: "auto",
  targetLanguage: "zh",
  useLocalSessions: true,
  useOnDeviceTranslation: true,
  onDeviceTranslationProvider: "ios_system",
  onDeviceTranslationRequired: true,
  gatewayProvider: "lmstudio",
  gatewayAsrProvider: "mock",
  gatewaySessionEventSink: "api",
});
