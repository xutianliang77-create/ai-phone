import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkIosNativeAsrBridge } from "./ios_native_asr_bridge_check.mjs";

let tempDir = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("checkIosNativeAsrBridge", () => {
  test("passes when Flutter and Swift bridge evidence is present", () => {
    tempDir = makeProject();

    expect(checkIosNativeAsrBridge(tempDir)).toMatchObject({
      status: "ready",
      failures: [],
    });
  });

  test("fails when a required channel method is missing", () => {
    tempDir = makeProject({ swiftBridge: "let methodChannelName = \"translation_mobile/core_ml_nemotron_asr\"" });

    const result = checkIosNativeAsrBridge(tempDir);

    expect(result.status).toBe("not_ready");
    expect(result.failures.map((failure) => failure.label)).toContain(
      "Swift handles start",
    );
  });

  test("fails when device ASR does not enable Apple voice processing", () => {
    tempDir = makeProject({ audioInput: `
AVAudioEngine(); let targetSampleRate = 16_000.0; configureAudioSession();
audioSessionError = error.localizedDescription; installTap; AVAudioConverter(); flushPending
` });

    const result = checkIosNativeAsrBridge(tempDir);

    expect(result.status).toBe("not_ready");
    expect(result.failures.map((failure) => failure.label)).toContain(
      "Swift enables Apple voice processing",
    );
  });
});

function makeProject(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "ios-asr-bridge-"));
  write(root, "apps/mobile/lib/src/platform/asr/core_ml_nemotron_asr_provider.dart", `
const MethodChannel('translation_mobile/core_ml_nemotron_asr');
const EventChannel('translation_mobile/core_ml_nemotron_asr/events');
invokeMapMethod<String, Object?>('isAvailable');
invokeMapMethod<String, Object?>('inspectModel');
invokeMethod<void>('requestPermission');
invokeMethod<void>('prepare');
invokeMethod<void>('start');
invokeMethod<void>('recordDiagnosticEvent');
invokeMethod<void>('stop');
final args = {
  'language': config.language,
  'chunkDurationMs': config.chunkDurationMs,
  'modelChunkMs': config.modelChunkMs,
  'autoDownloadModel': config.autoDownloadModel,
  'endpointMinSpeechMs': config.endpointMinSpeechMs,
  'endpointSilenceMs': config.endpointSilenceMs,
  'endpointSpeechThresholdRms': config.endpointSpeechThresholdRms,
  'vadProvider': config.vadProvider,
  'vadThreshold': config.vadThreshold,
  'vadNegativeThreshold': config.vadNegativeThreshold,
  'vadPreRollMs': config.vadPreRollMs,
  'turnRoutingPolicy': config.turnRoutingPolicy,
  'diagnosticCaptureEnabled': config.diagnosticCaptureEnabled,
  'diagnosticSessionId': config.diagnosticSessionId,
};
if (payload['type'] == 'runtime.error') throw PlatformException(
`);
  write(root, "apps/mobile/lib/src/platform/asr/asr_text_segment.dart", `
json['id']; json['text']; json['language']; json['isFinal'];
`);
  write(root, "apps/mobile/lib/src/features/realtime/presentation/controllers/realtime_controller_speech.dart", `
'tts.begin'
'tts.end'
'tts.stop_requested'
'requiresAcousticEchoSuppression'
`);
  write(root, "apps/mobile/lib/src/features/realtime/presentation/controllers/realtime_controller_device_asr_recovery.dart", `
type.startsWith('tts.')
!isNativePlaybackControl
`);
  write(root, "apps/mobile/ios/Runner/CoreMlNemotronAsrBridge.swift", overrides.swiftBridge ?? `
let methodChannelName = "translation_mobile/core_ml_nemotron_asr"
let eventChannelName = "translation_mobile/core_ml_nemotron_asr/events"
case "isAvailable": break
case "inspectModel": break
case "requestPermission": break
case "prepare": break
case "start": break
case "recordDiagnosticEvent": break
case "stop": break
stop(keepPrepared: true)
stringArgument("language", from: call)
intArgument("chunkDurationMs", from: call)
intArgument("modelChunkMs", from: call)
boolArgument("autoDownloadModel", from: call)
intArgument("endpointMinSpeechMs", from: call)
intArgument("endpointSilenceMs", from: call)
doubleArgument("endpointSpeechThresholdRms", from: call)
stringArgument("vadProvider", from: call)
doubleArgument("vadThreshold", from: call)
doubleArgument("vadNegativeThreshold", from: call)
intArgument("vadPreRollMs", from: call)
stringArgument("turnRoutingPolicy", from: call)
boolArgument("diagnosticCaptureEnabled", from: call)
"fluidAudio"; "microphone"
`);
  write(root, "apps/mobile/ios/Runner/CoreMlNemotronFluidAudioAdapter.swift", `
StreamingNemotronMultilingualAsrManager()
setPartialCallback {}
finish()
func stop(keepPrepared: Bool = false) {}
if !keepPrepared || stopError != nil {}
["id": segmentId, "text": trimmed, "language": gatewayLanguageCode(language), "isFinal": isFinal]
"processingError"
lastProcessingError
processingError ?? lastProcessingError
"type": "runtime.error"
handleRuntimeError(
CoreMlNemotronFluidVad()
vadPipeline.accept(samples: samples)
decision.samplesToProcess
CoreMlNemotronLanguageRouter()
CoreMlNemotronDiagnosticRecorder()
playbackEchoState.record(type: type, payload: payload)
"playbackEcho"
"bargeIn": decision.bargeIn
"asr.partial"
"asr.final"
"endpoint.finalize"
reset()
`);
  write(root, "apps/mobile/ios/Runner/CoreMlNemotronFluidVad.swift", `
VadManager()
processStreamingChunk()
preRollSamples
speechStartAllowed
tts_active_low_energy
tts_tail_low_energy
discardedEchoPreRollChunks
allowedBargeIns
"gateReason"
rms_fallback
fluidaudio_silero
`);
  write(root, "apps/mobile/ios/Runner/CoreMlNemotronEndpointDetector.swift", `
minSpeechMs: Int = 600
vadNegativeThreshold
candidateSpeechSamples
speechStartAllowed
`);
  write(root, "apps/mobile/ios/Runner/CoreMlNemotronDiagnosticRecorder.swift", `
coreml-nemotron-
wavData
"timeline"
modelFingerprint
`);
  write(root, "apps/mobile/ios/Runner/CoreMlNemotronLanguageRouter.swift", `
case "turn":
turnPolicy
hasChinese && hasLatin
`);
  write(root, "apps/mobile/ios/Runner/CoreMlNemotronAudioInput.swift", overrides.audioInput ?? `
AVAudioEngine(); let targetSampleRate = 16_000.0; configureAudioSession();
audioSessionError = error.localizedDescription
setVoiceProcessingEnabled(true)
isVoiceProcessingEnabled
isVoiceProcessingAGCEnabled = false
"lastVoiceProcessingEnabled"
voiceProcessingError = error.localizedDescription
onRuntimeError
installTap; AVAudioConverter(); flushPending
`);
  write(root, "apps/mobile/ios/Runner/AppDelegate.swift", `
CoreMlNemotronAsrBridge(
coreMlNemotronAsrBridge.register(messenger: messenger)
`);
  return root;
}

function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
