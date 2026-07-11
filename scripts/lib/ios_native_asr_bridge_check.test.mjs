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
invokeMethod<void>('stop');
final args = {
  'language': config.language,
  'chunkDurationMs': config.chunkDurationMs,
  'modelChunkMs': config.modelChunkMs,
  'autoDownloadModel': config.autoDownloadModel,
  'endpointMinSpeechMs': config.endpointMinSpeechMs,
  'endpointSilenceMs': config.endpointSilenceMs,
  'endpointSpeechThresholdRms': config.endpointSpeechThresholdRms,
};
`);
  write(root, "apps/mobile/lib/src/platform/asr/asr_text_segment.dart", `
json['id']; json['text']; json['language']; json['isFinal'];
`);
  write(root, "apps/mobile/ios/Runner/CoreMlNemotronAsrBridge.swift", overrides.swiftBridge ?? `
let methodChannelName = "translation_mobile/core_ml_nemotron_asr"
let eventChannelName = "translation_mobile/core_ml_nemotron_asr/events"
case "isAvailable": break
case "inspectModel": break
case "requestPermission": break
case "prepare": break
case "start": break
case "stop": break
stop(keepPrepared: true)
stringArgument("language", from: call)
intArgument("chunkDurationMs", from: call)
intArgument("modelChunkMs", from: call)
boolArgument("autoDownloadModel", from: call)
intArgument("endpointMinSpeechMs", from: call)
intArgument("endpointSilenceMs", from: call)
doubleArgument("endpointSpeechThresholdRms", from: call)
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
endpointDetector.accept(samples: samples)
options.endpointSilenceMs
reset()
`);
  write(root, "apps/mobile/ios/Runner/CoreMlNemotronAudioInput.swift", `
AVAudioEngine(); let targetSampleRate = 16_000.0; configureAudioSession();
audioSessionError = error.localizedDescription; installTap; AVAudioConverter(); flushPending
`);
  write(root, "apps/mobile/ios/Runner/AppDelegate.swift", `
CoreMlNemotronAsrBridge()
coreMlNemotronAsrBridge.register(messenger: messenger)
`);
  return root;
}

function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
