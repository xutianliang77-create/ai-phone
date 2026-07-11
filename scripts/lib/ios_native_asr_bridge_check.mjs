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
  ]);
  requireContains(checks, root, "apps/mobile/lib/src/platform/asr/asr_text_segment.dart", [
    ["json['id']", "Dart parses ASR event id"],
    ["json['text']", "Dart parses ASR event text"],
    ["json['language']", "Dart parses ASR event language"],
    ["json['isFinal']", "Dart parses ASR event final flag"],
  ]);
  requireContains(checks, root, "apps/mobile/ios/Runner/CoreMlNemotronAsrBridge.swift", [
    ["methodChannelName = \"translation_mobile/core_ml_nemotron_asr\"", "Swift MethodChannel name"],
    ["eventChannelName = \"translation_mobile/core_ml_nemotron_asr/events\"", "Swift EventChannel name"],
    ["case \"isAvailable\"", "Swift handles isAvailable"],
    ["case \"inspectModel\"", "Swift handles inspectModel"],
    ["case \"requestPermission\"", "Swift handles requestPermission"],
    ["case \"prepare\"", "Swift handles prepare"],
    ["case \"start\"", "Swift handles start"],
    ["case \"stop\"", "Swift handles stop"],
    ["stop(keepPrepared: true)", "Swift keeps prepared ASR model on stream cancel"],
    ["stringArgument(\"language\"", "Swift reads language option"],
    ["intArgument(\"chunkDurationMs\"", "Swift reads audio chunk option"],
    ["intArgument(\"modelChunkMs\"", "Swift reads model chunk option"],
    ["boolArgument(\"autoDownloadModel\"", "Swift reads download option"],
    ["intArgument(\"endpointMinSpeechMs\"", "Swift reads endpoint min speech option"],
    ["intArgument(\"endpointSilenceMs\"", "Swift reads endpoint silence option"],
    ["doubleArgument(\"endpointSpeechThresholdRms\"", "Swift reads endpoint RMS option"],
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
    ["endpointDetector.accept", "Swift runs endpoint detector"],
    ["options.endpointSilenceMs", "Swift configures endpoint detector"],
    ["reset()", "Swift resets manager after endpoint"],
  ]);
  requireContains(checks, root, "apps/mobile/ios/Runner/CoreMlNemotronAudioInput.swift", [
    ["AVAudioEngine", "Swift uses native microphone engine"],
    ["targetSampleRate = 16_000.0", "Swift targets 16 kHz ASR input"],
    ["configureAudioSession", "Swift records audio session setup failures"],
    ["audioSessionError = error.localizedDescription", "Swift exposes audio session setup error"],
    ["installTap", "Swift installs microphone tap"],
    ["AVAudioConverter", "Swift converts input audio"],
    ["flushPending", "Swift flushes tail audio"],
  ]);
  requireContains(checks, root, "apps/mobile/ios/Runner/AppDelegate.swift", [
    ["CoreMlNemotronAsrBridge()", "AppDelegate creates bridge"],
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
