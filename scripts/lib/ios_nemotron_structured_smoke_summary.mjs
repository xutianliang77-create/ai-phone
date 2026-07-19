export function summarizeSelfTestResult(payload) {
  if (!payload) return null;
  const audioAfterStop = availabilityAudio(payload.availabilityAfterStop);
  return compactObject({
    deviceAsrProvider: payload.deviceAsrProvider,
    deviceAsrLanguage: payload.deviceAsrLanguage,
    modelChunkMs: payload.modelChunkMs,
    autoDownloadModel: payload.autoDownloadModel,
    canStart: payload.availability?.canStart,
    reason: payload.availability?.reason,
    ...runtimeAfterStartSummary(payload.availabilityAfterStart),
    segmentCount: payload.segmentCount,
    receivedCharCounts: payload.receivedCharCounts,
    expectSegment: payload.expectSegment,
    durationSeconds: payload.durationSeconds,
    ...audioSummary(audioAfterStop),
    error: payload.error,
    stopError: payload.stopError,
    audioCaptureError: payload.audioCaptureError,
  });
}

export function summarizeGatewayE2eResult(payload) {
  if (!payload) return null;
  const audioAfterStop = availabilityAudio(payload.availabilityAfterStop);
  return compactObject({
    deviceAsrProvider: payload.deviceAsrProvider,
    deviceAsrLanguage: payload.deviceAsrLanguage,
    sourceLanguage: payload.sourceLanguage,
    targetLanguage: payload.targetLanguage,
    modelChunkMs: payload.modelChunkMs,
    autoDownloadModel: payload.autoDownloadModel,
    canStart: payload.availability?.canStart,
    reason: payload.availability?.reason,
    ...runtimeAfterStartSummary(payload.availabilityAfterStart),
    apiHealthOk: payload.apiHealthOk,
    gatewayProvider: payload.gatewayHealth?.provider,
    gatewayAsrProvider: payload.gatewayHealth?.asrProvider,
    gatewaySessionEventSink: payload.gatewayHealth?.sessionEventSink,
    asrSent: payload.asrSent,
    asrSendStarted: payload.asrSendStarted,
    translationFinal: payload.translationFinal,
    expectTranslation: payload.expectTranslation,
    serverOwnedHistory: payload.serverOwnedHistory,
    segmentCount: payload.segmentCount,
    historyDetailLoaded: payload.historyDetailLoaded,
    historySaved: payload.historySaved,
    historySegmentCount: payload.historySegmentCount,
    historyStatus: payload.historyStatus,
    durationSeconds: payload.durationSeconds,
    ...audioSummary(audioAfterStop),
    error: payload.error,
    stopError: payload.stopError,
    endError: payload.endError,
    asrSendError: payload.asrSendError,
    translationError: payload.translationError,
    historyError: payload.historyError,
    audioCaptureError: payload.audioCaptureError,
    apiHealthError: payload.apiHealthError,
  });
}

export function summarizeLocalMvpResult(payload) {
  if (!payload) return null;
  const audioAfterStop = availabilityAudio(payload.availabilityAfterStop);
  return compactObject({
    deviceAsrProvider: payload.deviceAsrProvider,
    deviceAsrLanguage: payload.deviceAsrLanguage,
    sourceLanguage: payload.sourceLanguage,
    targetLanguage: payload.targetLanguage,
    modelChunkMs: payload.modelChunkMs,
    autoDownloadModel: payload.autoDownloadModel,
    useLocalSessions: payload.useLocalSessions,
    useOnDeviceTranslation: payload.useOnDeviceTranslation,
    onDeviceTranslationProvider: payload.onDeviceTranslationProvider,
    onDeviceTranslationRequired: payload.onDeviceTranslationRequired,
    translationAvailable: payload.translationAvailability?.available,
    translationProvider: payload.translationAvailability?.provider,
    translationStatus: payload.translationAvailability?.status,
    translationReason: payload.translationAvailability?.reason,
    translationSourceLanguage: payload.translationAvailability?.sourceLanguage,
    translationTargetLanguage: payload.translationAvailability?.targetLanguage,
    canStart: payload.availability?.canStart,
    reason: payload.availability?.reason,
    ...runtimeAfterStartSummary(payload.availabilityAfterStart),
    segmentCount: payload.segmentCount,
    sourceCharCounts: payload.sourceCharCounts,
    translatedCharCounts: payload.translatedCharCounts,
    translationFinal: payload.translationFinal,
    expectTranslation: payload.expectTranslation,
    historyDetailLoaded: payload.historyDetailLoaded,
    localHistorySaved: payload.localHistorySaved,
    localExportReady: payload.localExportReady,
    historySegmentCount: payload.historySegmentCount,
    historyStatus: payload.historyStatus,
    exportCharCount: payload.exportCharCount,
    durationSeconds: payload.durationSeconds,
    ...audioSummary(audioAfterStop),
    error: payload.error,
    stopError: payload.stopError,
    translationError: payload.translationError,
    historyError: payload.historyError,
    audioCaptureError: payload.audioCaptureError,
  });
}

function runtimeAfterStartSummary(availability) {
  const fluidAudio = availability?.fluidAudio ?? null;
  const modelScan = availability?.modelScan ?? null;
  return {
    decoderReadyAfterStart: availability?.decoderReady,
    localModelReadyAfterStart: availability?.localModelReady,
    preparedModelReadyAfterStart: availability?.preparedModelReady,
    fluidAudioRuntimeAvailableAfterStart: fluidAudio?.runtimeAvailable,
    fluidAudioPreparedAfterStart: fluidAudio?.prepared,
    modelScanStatusAfterStart: modelScan?.selectedStatus,
    modelScanLayoutAfterStart: modelScan?.selectedLayout,
  };
}

function audioSummary(audio) {
  return {
    audioSessionActive: audio?.sessionActive,
    audioSessionError: audio?.sessionError,
    audioVoiceProcessingPolicy: audio?.voiceProcessingPolicy,
    audioVoiceProcessingAttempted: audio?.voiceProcessingAttempted,
    audioLastVoiceProcessingEnabled: audio?.lastVoiceProcessingEnabled,
    audioLastVoiceProcessingAgcEnabled: audio?.lastVoiceProcessingAgcEnabled,
    audioVoiceProcessingError: audio?.voiceProcessingError,
    audioProcessingError: audio?.processingError,
    audioInputBuffers: audio?.inputBuffers,
    audioEmittedChunks: audio?.emittedChunks,
    audioConversionFailures: audio?.conversionFailures,
    audioFloatExtractionFailures: audio?.floatExtractionFailures,
    audioFlushedTailSamples: audio?.flushedTailSamples,
    audioLastConversionError: audio?.lastConversionError,
    audioLastChunkRms: audio?.lastChunkRms,
  };
}

function availabilityAudio(availability) {
  const audio = availability?.audio ?? availability?.fluidAudio?.audio ?? null;
  const processingError = availability?.fluidAudio?.processingError;
  if (!audio) {
    return processingError ? { processingError } : null;
  }
  return processingError ? { ...audio, processingError } : audio;
}

function compactObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}
