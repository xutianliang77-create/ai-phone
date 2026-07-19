import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function checkIosNativeAsrBridge(root) {
  const checks = [];
  requireContains(checks, root, "apps/mobile/lib/src/platform/asr/core_ml_nemotron_asr_provider.dart", [
    ["translation_mobile/core_ml_nemotron_asr", "Dart MethodChannel name"],
    ["translation_mobile/core_ml_nemotron_asr/events", "Dart EventChannel name"],
    ["invokeMapMethod<String, Object?>", "Dart availability/model map calls"],
    ["'isAvailable'", "Dart calls isAvailable"],
    ["'inspectModel'", "Dart calls inspectModel"],
    ["'requestPermission'", "Dart calls requestPermission"],
    ["'prepare'", "Dart calls prepare"],
    ["'start'", "Dart calls start"],
    ["'stop'", "Dart calls stop"],
    ["'language': config.language", "Dart sends language option"],
    ["'chunkDurationMs': config.chunkDurationMs", "Dart sends audio chunk option"],
    ["'modelChunkMs': config.modelChunkMs", "Dart sends model chunk option"],
    ["'autoDownloadModel': config.autoDownloadModel", "Dart sends download option"],
    ["'endpointMinSpeechMs': config.endpointMinSpeechMs", "Dart sends endpoint min speech option"],
    ["'endpointSilenceMs': config.endpointSilenceMs", "Dart sends endpoint silence option"],
    ["'endpointSpeechThresholdRms': config.endpointSpeechThresholdRms", "Dart sends endpoint RMS option"],
    ["'vadProvider': config.vadProvider", "Dart sends VAD provider"],
    ["'vadThreshold': config.vadThreshold", "Dart sends VAD onset threshold"],
    ["'vadNegativeThreshold': config.vadNegativeThreshold", "Dart sends VAD offset threshold"],
    ["'vadPreRollMs': config.vadPreRollMs", "Dart sends VAD pre-roll"],
    ["'turnRoutingPolicy': config.turnRoutingPolicy", "Dart sends turn routing policy"],
    ["'diagnosticCaptureEnabled': config.diagnosticCaptureEnabled", "Dart sends diagnostic capture flag"],
    ["'diagnosticSessionId': config.diagnosticSessionId", "Dart sends diagnostic session id"],
    ["'recordDiagnosticEvent'", "Dart forwards TTS and capture-gate events"],
    ["payload['type'] == 'runtime.error'", "Dart surfaces native runtime errors"],
    ["throw PlatformException(", "Dart emits ASR stream errors"],
  ]);
  requireContains(checks, root, "apps/mobile/lib/src/platform/asr/asr_text_segment.dart", [
    ["json['id']", "Dart parses ASR event id"],
    ["json['text']", "Dart parses ASR event text"],
    ["json['language']", "Dart parses ASR event language"],
    ["json['isFinal']", "Dart parses ASR event final flag"],
  ]);
  requireContains(checks, root, "apps/mobile/lib/src/features/realtime/presentation/controllers/realtime_controller_speech.dart", [
    ["'tts.begin'", "Dart reports TTS start to native ASR"],
    ["'tts.end'", "Dart reports TTS end to native ASR"],
    ["'tts.stop_requested'", "Dart reports TTS stop to native ASR"],
    ["'requiresAcousticEchoSuppression'", "Dart reports whether playback uses speakers"],
  ]);
  requireContains(checks, root, "apps/mobile/lib/src/features/realtime/presentation/controllers/realtime_controller_device_asr_recovery.dart", [
    ["type.startsWith('tts.')", "Dart always forwards native TTS control events"],
    ["!isNativePlaybackControl", "Dart keeps non-control diagnostics behind capture flag"],
  ]);
  requireContains(checks, root, "apps/mobile/ios/Runner/CoreMlNemotronAsrBridge.swift", [
    ["methodChannelName = \"translation_mobile/core_ml_nemotron_asr\"", "Swift MethodChannel name"],
    ["eventChannelName = \"translation_mobile/core_ml_nemotron_asr/events\"", "Swift EventChannel name"],
    ["case \"isAvailable\"", "Swift handles isAvailable"],
    ["case \"inspectModel\"", "Swift handles inspectModel"],
    ["case \"requestPermission\"", "Swift handles requestPermission"],
    ["case \"prepare\"", "Swift handles prepare"],
    ["case \"start\"", "Swift handles start"],
    ["case \"recordDiagnosticEvent\"", "Swift handles external diagnostic events"],
    ["case \"stop\"", "Swift handles stop"],
    ["stop(keepPrepared: true)", "Swift keeps prepared ASR model on stream cancel"],
    ["stringArgument(\"language\"", "Swift reads language option"],
    ["intArgument(\"chunkDurationMs\"", "Swift reads audio chunk option"],
    ["intArgument(\"modelChunkMs\"", "Swift reads model chunk option"],
    ["boolArgument(\"autoDownloadModel\"", "Swift reads download option"],
    ["intArgument(\"endpointMinSpeechMs\"", "Swift reads endpoint min speech option"],
    ["intArgument(\"endpointSilenceMs\"", "Swift reads endpoint silence option"],
    ["doubleArgument(\"endpointSpeechThresholdRms\"", "Swift reads endpoint RMS option"],
    ["stringArgument(\"vadProvider\"", "Swift reads VAD provider"],
    ["doubleArgument(\"vadThreshold\"", "Swift reads VAD onset threshold"],
    ["doubleArgument(\"vadNegativeThreshold\"", "Swift reads VAD offset threshold"],
    ["intArgument(\"vadPreRollMs\"", "Swift reads VAD pre-roll"],
    ["stringArgument(\"turnRoutingPolicy\"", "Swift reads turn routing policy"],
    ["boolArgument(\"diagnosticCaptureEnabled\"", "Swift reads capture flag"],
    ["\"fluidAudio\"", "Swift exposes FluidAudio diagnostics"],
    ["\"microphone\"", "Swift exposes microphone diagnostics"],
  ]);
  requireContains(checks, root, "apps/mobile/ios/Runner/CoreMlNemotronFluidAudioAdapter.swift", [
    ["StreamingNemotronMultilingualAsrManager", "Swift uses FluidAudio Nemotron manager"],
    ["setPartialCallback", "Swift emits partial ASR events"],
    ["finish()", "Swift finalizes ASR segments"],
    ["keepPrepared: Bool = false", "Swift stop can preserve prepared manager"],
    ["!keepPrepared || stopError != nil", "Swift cleanup still runs on explicit stop or error"],
    ["\"id\": segmentId", "Swift emits event id"],
    ["\"text\": trimmed", "Swift emits event text"],
    ["\"language\": gatewayLanguageCode", "Swift emits gateway language"],
    ["\"isFinal\": isFinal", "Swift emits final flag"],
    ["\"processingError\"", "Swift exposes FluidAudio processing errors"],
    ["lastProcessingError", "Swift retains last FluidAudio processing error"],
    ["processingError ?? lastProcessingError", "Swift reports retained processing error"],
    ["\"type\": \"runtime.error\"", "Swift emits runtime error events"],
    ["handleRuntimeError(", "Swift centralizes fatal runtime errors"],
    ["CoreMlNemotronFluidVad", "Swift uses FluidAudio VAD pipeline"],
    ["vadPipeline.accept", "Swift runs neural VAD before ASR"],
    ["decision.samplesToProcess", "Swift gates ASR with VAD and pre-roll"],
    ["CoreMlNemotronLanguageRouter", "Swift supports turn-level language routing"],
    ["CoreMlNemotronDiagnosticRecorder", "Swift persists diagnostic capture"],
    ["playbackEchoState.record", "Swift synchronizes TTS state into native VAD"],
    ["\"playbackEcho\"", "Swift exposes native playback echo state"],
    ["\"bargeIn\": decision.bargeIn", "Swift records accepted acoustic barge-in"],
    ["\"asr.partial\"", "Swift records partial timeline events"],
    ["\"asr.final\"", "Swift records final timeline events"],
    ["\"endpoint.finalize\"", "Swift records endpoint timeline events"],
    ["reset()", "Swift resets manager after endpoint"],
  ]);
  requireContains(checks, root, "apps/mobile/ios/Runner/CoreMlNemotronFluidVad.swift", [
    ["VadManager", "Swift uses FluidAudio Silero VAD"],
    ["processStreamingChunk", "Swift performs streaming VAD inference"],
    ["preRollSamples", "Swift buffers speech pre-roll"],
    ["speechStartAllowed", "Swift gates only speech start during echo windows"],
    ["tts_active_low_energy", "Swift identifies low-energy active TTS echo"],
    ["tts_tail_low_energy", "Swift identifies low-energy TTS tail echo"],
    ["discardedEchoPreRollChunks", "Swift excludes gated echo from pre-roll"],
    ["allowedBargeIns", "Swift preserves high-energy barge-in"],
    ["\"gateReason\"", "Swift persists echo gate decisions"],
    ["rms_fallback", "Swift exposes RMS fallback"],
    ["fluidaudio_silero", "Swift exposes active neural VAD provider"],
  ]);
  requireContains(checks, root, "apps/mobile/ios/Runner/CoreMlNemotronEndpointDetector.swift", [
    ["minSpeechMs: Int = 600", "Swift locks stable 600ms minimum speech"],
    ["vadNegativeThreshold", "Swift applies VAD hysteresis"],
    ["candidateSpeechSamples", "Swift suppresses short noise spikes"],
    ["speechStartAllowed", "Swift accepts native echo-aware start gating"],
  ]);
  requireContains(checks, root, "apps/mobile/ios/Runner/CoreMlNemotronDiagnosticRecorder.swift", [
    ["coreml-nemotron-", "Swift persists per-session diagnostics"],
    ["wavData", "Swift writes diagnostic WAV audio"],
    ["\"timeline\"", "Swift writes diagnostic event timeline"],
    ["modelFingerprint", "Swift records actual model fingerprint"],
  ]);
  requireContains(checks, root, "apps/mobile/ios/Runner/CoreMlNemotronLanguageRouter.swift", [
    ["case \"turn\"", "Swift accepts turn routing mode"],
    ["turnPolicy", "Swift differentiates conversation and listening routing"],
    ["hasChinese && hasLatin", "Swift keeps mixed turns on auto"],
  ]);
  requireContains(checks, root, "apps/mobile/ios/Runner/CoreMlNemotronAudioInput.swift", [
    ["AVAudioEngine", "Swift uses native microphone engine"],
    ["targetSampleRate = 16_000.0", "Swift targets 16 kHz ASR input"],
    ["configureAudioSession", "Swift records audio session setup failures"],
    ["audioSessionError = error.localizedDescription", "Swift exposes audio session setup error"],
    ["setVoiceProcessingEnabled(true)", "Swift enables Apple voice processing"],
    ["isVoiceProcessingEnabled", "Swift verifies Apple voice processing activation"],
    ["isVoiceProcessingAGCEnabled = false", "Swift keeps device ASR AGC disabled"],
    ["\"lastVoiceProcessingEnabled\"", "Swift exposes voice processing diagnostics"],
    ["voiceProcessingError = error.localizedDescription", "Swift exposes voice processing failure"],
    ["onRuntimeError", "Swift reports audio conversion failures"],
    ["installTap", "Swift installs microphone tap"],
    ["AVAudioConverter", "Swift converts input audio"],
    ["flushPending", "Swift flushes tail audio"],
  ]);
  requireContains(checks, root, "apps/mobile/ios/Runner/AppDelegate.swift", [
    ["CoreMlNemotronAsrBridge(", "AppDelegate creates bridge"],
    ["coreMlNemotronAsrBridge.register", "AppDelegate registers bridge"],
  ]);

  const failures = checks.filter((check) => !check.pass);
  return {
    schemaVersion: 1,
    status: failures.length === 0 ? "ready" : "not_ready",
    checks,
    failures,
  };
}

function requireContains(checks, root, relativePath, definitions) {
  const file = path.join(root, relativePath);
  const content = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (!content) {
    checks.push({
      file: relativePath,
      label: "file exists",
      pass: false,
      issue: `${relativePath} is missing or empty`,
    });
    return;
  }
  for (const [needle, label] of definitions) {
    const pass = content.includes(needle);
    checks.push({
      file: relativePath,
      label,
      pass,
      issue: pass ? null : `${relativePath} missing ${needle}`,
    });
  }
}
