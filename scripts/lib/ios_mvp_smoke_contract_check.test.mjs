import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkIosMvpSmokeContract } from "./ios_mvp_smoke_contract_check.mjs";

let tempDir = null;
afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("checkIosMvpSmokeContract", () => {
  test("passes when the final smoke path covers MVP evidence", () => {
    tempDir = makeProject();

    expect(checkIosMvpSmokeContract(tempDir)).toMatchObject({
      status: "ready",
      failures: [],
    });
  });

  test("fails when the local MVP test stops checking history", () => {
    tempDir = makeProject({
      localMvp: "'DEVICE_ASR_EXPECT_TRANSLATION'; defaultValue: true; translationFinal",
    });

    const result = checkIosMvpSmokeContract(tempDir);

    expect(result.status).toBe("not_ready");
    expect(result.failures.map((failure) => failure.label)).toContain(
      "e2e checks history saved",
    );
  });

  test("fails when Gateway privacy evidence stops using recursive checks", () => {
    tempDir = makeProject({
      reportEvidence: `
smokeStructuredResultIssues
COREML_NEMOTRON_SELF_TEST_SEGMENT
COREML_NEMOTRON_LOCAL_MVP_RESULT
COREML_NEMOTRON_LOCAL_MVP_HISTORY
audioSessionError
LOCAL_MVP_HISTORY_ERROR
smokeLogPrivacy
Smoke log text privacy issue
SELF_TEST_STOP_ERROR
`,
    });

    const result = checkIosMvpSmokeContract(tempDir);

    expect(result.status).toBe("not_ready");
    expect(result.failures.map((failure) => failure.label)).toContain(
      "report recursively checks Gateway text privacy",
    );
  });

  test("fails when smoke stops diagnosing audio session errors", () => {
    tempDir = makeProject({
      modelScanLog: "Device ASR did not receive microphone audio",
    });

    const result = checkIosMvpSmokeContract(tempDir);

    expect(result.status).toBe("not_ready");
    expect(result.failures.map((failure) => failure.label)).toContain(
      "smoke diagnoses audio session failure",
    );
  });

  test("fails when device smoke bypasses the runtime contract", () => {
    tempDir = makeProject({
      deviceSmoke: `
ALLOW_IOS_SIMULATOR:-false
DEVICE_ASR_EXPECT_SEGMENT:-true
DEVICE_ASR_EXPECT_TRANSLATION:-true
validate_ios_nemotron_bundle.mjs
--dart-define=USE_DEVICE_ASR=true
--dart-define=DEVICE_ASR_PROVIDER=coreml_nemotron
integration_test/core_ml_nemotron_mvp_test.dart
--dart-define=SERVER_OWNED_HISTORY="$SERVER_OWNED_HISTORY"
`,
    });

    const result = checkIosMvpSmokeContract(tempDir);

    expect(result.status).toBe("not_ready");
    expect(result.failures.map((failure) => failure.label)).toContain(
      "device smoke defaults Core ML Nemotron provider from contract",
    );
  });

  test("fails when MVP smoke hardcodes the history sink", () => {
    tempDir = makeProject({
      mvpSmoke: `
ios_nemotron_runtime_contract_env.mjs
RUNTIME_CONTRACT_ENV="$(node "$ROOT_DIR/scripts/ios_nemotron_runtime_contract_env.mjs")"
eval "$RUNTIME_CONTRACT_ENV"
DEVICE_ASR_AUTO_DOWNLOAD_MODEL:-$IOS_NEMOTRON_CONTRACT_AUTO_DOWNLOAD_MODEL
DEVICE_ASR_MODEL_CHUNK_MS:-$IOS_NEMOTRON_CONTRACT_MODEL_CHUNK_MS; SOURCE_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_SOURCE_LANGUAGE; TARGET_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_TARGET_LANGUAGE
USE_LOCAL_SESSIONS:-$IOS_NEMOTRON_CONTRACT_USE_LOCAL_SESSIONS; USE_ON_DEVICE_TRANSLATION:-$IOS_NEMOTRON_CONTRACT_USE_ON_DEVICE_TRANSLATION; ON_DEVICE_TRANSLATION_PROVIDER:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_PROVIDER; ON_DEVICE_TRANSLATION_REQUIRED:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_REQUIRED
REALTIME_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER
ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER
EXPECTED_GATEWAY_PROVIDER:-$REALTIME_PROVIDER
EXPECTED_GATEWAY_ASR_PROVIDER:-$ASR_PROVIDER
DEVICE_ASR_PREPARE_MODEL:-true
DEVICE_ASR_SELF_TEST_SECONDS:-20
DEVICE_ASR_E2E_SECONDS:-45
DEVICE_ASR_MODEL_CHUNK_MS="$DEVICE_ASR_MODEL_CHUNK_MS"; SOURCE_LANGUAGE="$SOURCE_LANGUAGE"; TARGET_LANGUAGE="$TARGET_LANGUAGE"
USE_LOCAL_SESSIONS="$USE_LOCAL_SESSIONS"; USE_ON_DEVICE_TRANSLATION="$USE_ON_DEVICE_TRANSLATION"; ON_DEVICE_TRANSLATION_PROVIDER="$ON_DEVICE_TRANSLATION_PROVIDER"; ON_DEVICE_TRANSLATION_REQUIRED="$ON_DEVICE_TRANSLATION_REQUIRED"
IOS_SMOKE_MODE=mvp
check_ios_runtime_permissions.mjs
diagnose_ios_device.mjs
check_e2e_services
health.realtimeWsEndpoint !== expected
health.provider !== expectedProvider
health.asrProvider !== expectedAsrProvider
health.sessionEventSink !== "api"
`,
    });

    const result = checkIosMvpSmokeContract(tempDir);

    expect(result.status).toBe("not_ready");
    expect(result.failures.map((failure) => failure.label)).toContain(
      "smoke checks configured history sink",
    );
  });

  test("fails when diagnostics report exports selftest text", () => {
    tempDir = makeProject({
      diagnosticsReport: "textCharCount; segment.text.length; 'text': segment.text",
    });

    const result = checkIosMvpSmokeContract(tempDir);

    expect(result.status).toBe("not_ready");
    expect(result.failures.map((failure) => failure.label)).toContain(
      "diagnostics report does not export selftest text",
    );
  });
});

function makeProject(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "ios-smoke-contract-"));
  write(root, "scripts/ios_nemotron_run_mvp.sh", `
ios_nemotron_runtime_contract_env.mjs
RUNTIME_CONTRACT_ENV="$(node "$ROOT_DIR/scripts/ios_nemotron_runtime_contract_env.mjs")"
eval "$RUNTIME_CONTRACT_ENV"
IOS_MVP_SMOKE_STEPS:-diagnostics,selftest,local_mvp
DEVICE_ASR_AUTO_DOWNLOAD_MODEL:-$IOS_NEMOTRON_CONTRACT_AUTO_DOWNLOAD_MODEL
DEVICE_ASR_MODEL_CHUNK_MS:-$IOS_NEMOTRON_CONTRACT_MODEL_CHUNK_MS; SOURCE_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_SOURCE_LANGUAGE; TARGET_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_TARGET_LANGUAGE
USE_LOCAL_SESSIONS:-$IOS_NEMOTRON_CONTRACT_USE_LOCAL_SESSIONS; USE_ON_DEVICE_TRANSLATION:-$IOS_NEMOTRON_CONTRACT_USE_ON_DEVICE_TRANSLATION; ON_DEVICE_TRANSLATION_PROVIDER:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_PROVIDER; ON_DEVICE_TRANSLATION_REQUIRED:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_REQUIRED
REALTIME_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER
SESSION_EVENT_SINK:-$IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK
ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER
DEVICE_ASR_MODEL_CHUNK_MS="$DEVICE_ASR_MODEL_CHUNK_MS"; SOURCE_LANGUAGE="$SOURCE_LANGUAGE"; TARGET_LANGUAGE="$TARGET_LANGUAGE"
USE_LOCAL_SESSIONS="$USE_LOCAL_SESSIONS"; USE_ON_DEVICE_TRANSLATION="$USE_ON_DEVICE_TRANSLATION"; ON_DEVICE_TRANSLATION_PROVIDER="$ON_DEVICE_TRANSLATION_PROVIDER"; ON_DEVICE_TRANSLATION_REQUIRED="$ON_DEVICE_TRANSLATION_REQUIRED"
REALTIME_PROVIDER="$REALTIME_PROVIDER"
ASR_PROVIDER="$ASR_PROVIDER"; SESSION_EVENT_SINK="$SESSION_EVENT_SINK"
IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD=true
diagnose_ios_device.mjs
ios_nemotron_repair_provisioning.sh
ios_nemotron_local_preflight.sh
ios_nemotron_start_services.sh
ios_nemotron_mvp_status.mjs" --strict
ios_nemotron_mvp_smoke.sh
ios_nemotron_mvp_report.mjs
`);
  write(root, "scripts/ios_nemotron_mvp_smoke.sh", overrides.mvpSmoke ?? `
ios_nemotron_runtime_contract_env.mjs
RUNTIME_CONTRACT_ENV="$(node "$ROOT_DIR/scripts/ios_nemotron_runtime_contract_env.mjs")"
eval "$RUNTIME_CONTRACT_ENV"
DEVICE_ASR_AUTO_DOWNLOAD_MODEL:-$IOS_NEMOTRON_CONTRACT_AUTO_DOWNLOAD_MODEL
DEVICE_ASR_MODEL_CHUNK_MS:-$IOS_NEMOTRON_CONTRACT_MODEL_CHUNK_MS; SOURCE_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_SOURCE_LANGUAGE; TARGET_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_TARGET_LANGUAGE
USE_LOCAL_SESSIONS:-$IOS_NEMOTRON_CONTRACT_USE_LOCAL_SESSIONS; USE_ON_DEVICE_TRANSLATION:-$IOS_NEMOTRON_CONTRACT_USE_ON_DEVICE_TRANSLATION; ON_DEVICE_TRANSLATION_PROVIDER:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_PROVIDER; ON_DEVICE_TRANSLATION_REQUIRED:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_REQUIRED
REALTIME_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER
ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER
SESSION_EVENT_SINK:-$IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK
EXPECTED_GATEWAY_PROVIDER:-$REALTIME_PROVIDER
EXPECTED_GATEWAY_ASR_PROVIDER:-$ASR_PROVIDER
EXPECTED_GATEWAY_SESSION_EVENT_SINK:-$SESSION_EVENT_SINK
DEVICE_ASR_PREPARE_MODEL:-true
DEVICE_ASR_SELF_TEST_SECONDS:-20
DEVICE_ASR_E2E_SECONDS:-45
DEVICE_ASR_MODEL_CHUNK_MS="$DEVICE_ASR_MODEL_CHUNK_MS"; SOURCE_LANGUAGE="$SOURCE_LANGUAGE"; TARGET_LANGUAGE="$TARGET_LANGUAGE"
USE_LOCAL_SESSIONS="$USE_LOCAL_SESSIONS"; USE_ON_DEVICE_TRANSLATION="$USE_ON_DEVICE_TRANSLATION"; ON_DEVICE_TRANSLATION_PROVIDER="$ON_DEVICE_TRANSLATION_PROVIDER"; ON_DEVICE_TRANSLATION_REQUIRED="$ON_DEVICE_TRANSLATION_REQUIRED"
IOS_SMOKE_MODE=mvp
check_ios_runtime_permissions.mjs
diagnose_ios_device.mjs
check_e2e_services
health.realtimeWsEndpoint !== expected
health.provider !== expectedProvider
health.asrProvider !== expectedAsrProvider
health.sessionEventSink !== expectedSessionEventSink
`);
  write(root, "scripts/ios_nemotron_device_smoke.sh", overrides.deviceSmoke ?? `
ios_nemotron_runtime_contract_env.mjs
RUNTIME_CONTRACT_ENV="$(node "$ROOT_DIR/scripts/ios_nemotron_runtime_contract_env.mjs")"
eval "$RUNTIME_CONTRACT_ENV"
ALLOW_IOS_SIMULATOR:-false
DEVICE_ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_DEVICE_ASR_PROVIDER
DEVICE_ASR_AUTO_DOWNLOAD_MODEL:-$IOS_NEMOTRON_CONTRACT_AUTO_DOWNLOAD_MODEL
DEVICE_ASR_MODEL_CHUNK_MS:-$IOS_NEMOTRON_CONTRACT_MODEL_CHUNK_MS; SOURCE_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_SOURCE_LANGUAGE; TARGET_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_TARGET_LANGUAGE
USE_LOCAL_SESSIONS:-$IOS_NEMOTRON_CONTRACT_USE_LOCAL_SESSIONS; USE_ON_DEVICE_TRANSLATION:-$IOS_NEMOTRON_CONTRACT_USE_ON_DEVICE_TRANSLATION; ON_DEVICE_TRANSLATION_PROVIDER:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_PROVIDER; ON_DEVICE_TRANSLATION_REQUIRED:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_REQUIRED
EXPECTED_GATEWAY_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER
EXPECTED_GATEWAY_ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER
EXPECTED_GATEWAY_SESSION_EVENT_SINK:-$IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK
DEVICE_ASR_EXPECT_SEGMENT:-true
DEVICE_ASR_EXPECT_TRANSLATION:-true
validate_ios_nemotron_bundle.mjs
select_flutter_ios_device.mjs
--dart-define=USE_DEVICE_ASR=true
--dart-define=DEVICE_ASR_PROVIDER="$DEVICE_ASR_PROVIDER"; --dart-define=SOURCE_LANGUAGE="$SOURCE_LANGUAGE"; --dart-define=TARGET_LANGUAGE="$TARGET_LANGUAGE"
--dart-define=USE_LOCAL_SESSIONS="$USE_LOCAL_SESSIONS"; --dart-define=USE_ON_DEVICE_TRANSLATION="$USE_ON_DEVICE_TRANSLATION"; --dart-define=ON_DEVICE_TRANSLATION_PROVIDER="$ON_DEVICE_TRANSLATION_PROVIDER"; --dart-define=ON_DEVICE_TRANSLATION_REQUIRED="$ON_DEVICE_TRANSLATION_REQUIRED"
--dart-define=EXPECTED_GATEWAY_PROVIDER="$EXPECTED_GATEWAY_PROVIDER"
--dart-define=EXPECTED_GATEWAY_ASR_PROVIDER="$EXPECTED_GATEWAY_ASR_PROVIDER"
--dart-define=EXPECTED_GATEWAY_SESSION_EVENT_SINK="$EXPECTED_GATEWAY_SESSION_EVENT_SINK"
integration_test/core_ml_nemotron_mvp_test.dart
--dart-define=SERVER_OWNED_HISTORY="$SERVER_OWNED_HISTORY"
`);
  write(root, "scripts/select_flutter_ios_device.mjs", `
selectFlutterIosDevice; ALLOW_IOS_SIMULATOR; process.exit(2)
`);
  write(root, "scripts/lib/flutter_ios_device_selector.mjs", `
minIosMajor ?? 17; targetPlatform === "ios"; allowSimulator || !device.emulator; requires iOS
`);
  write(root, "apps/mobile/integration_test/core_ml_nemotron_mvp_test.dart", `
diagnostics.main(); self_test.main(); local_mvp.main();
`);
  write(root, "apps/mobile/integration_test/core_ml_nemotron_self_test.dart", `
'DEVICE_ASR_EXPECT_SEGMENT'; defaultValue: true; COREML_NEMOTRON_SELF_TEST_SEGMENT;
'deviceAsrProvider': 'coreml_nemotron'; 'modelChunkMs': modelChunkMs; 'autoDownloadModel': autoDownloadModel
coreMlNemotronAudioCaptureIssue; _deviceAsrStopDrain; COREML_NEMOTRON_SELF_TEST_RESULT
`);
  write(root, "apps/mobile/integration_test/core_ml_nemotron_local_mvp_test.dart", overrides.localMvp ?? `
'DEVICE_ASR_EXPECT_TRANSLATION'; defaultValue: true; RealtimeController(
SessionHistoryRepository.fromConfig; LocalSessionStore
'deviceAsrProvider': 'coreml_nemotron'; 'sourceLanguage': appConfig.sourceLanguage; 'targetLanguage': appConfig.targetLanguage
modelChunkMs: modelChunkMs; autoDownloadModel: autoDownloadModel
	_deviceAsrStopDrain; translationAvailability; translationFinal; localHistorySaved; localExportReady; expect(historyStatus, 'ended'); COREML_NEMOTRON_LOCAL_MVP_RESULT
`);
  write(root, "apps/mobile/integration_test/core_ml_nemotron_gateway_e2e_support.dart", `
'EXPECTED_GATEWAY_PROVIDER'
'EXPECTED_GATEWAY_ASR_PROVIDER'
'EXPECTED_GATEWAY_SESSION_EVENT_SINK'; 'sourceLanguage': sourceLanguage; 'targetLanguage': targetLanguage
gatewayHealthRoutingError
`);
  write(root, "apps/mobile/integration_test/core_ml_nemotron_model_scan_log.dart", overrides.modelScanLog ?? `
Device ASR audio session failed
audio.sessionError=
Device ASR did not receive microphone audio
`);
  write(root, "apps/mobile/lib/src/features/device_asr/data/core_ml_nemotron_diagnostics_report.dart", overrides.diagnosticsReport ?? `
textCharCount
segment.text.length
`);
  write(root, "apps/mobile/lib/src/features/realtime/presentation/controllers/realtime_controller.dart", `
_deviceAsrStopDrain
await _drainDeviceAsrStopEvents();
_asrTextChain
await _drainAsrTextSegments();
`);
  write(root, "scripts/lib/ios_nemotron_report_evidence.mjs", overrides.reportEvidence ?? `
smokeStructuredResultIssues
summarizeSelfTestResult
summarizeLocalMvpResult
COREML_NEMOTRON_SELF_TEST_SEGMENT
COREML_NEMOTRON_LOCAL_MVP_RESULT
COREML_NEMOTRON_LOCAL_MVP_HISTORY
LOCAL_MVP_HISTORY_ERROR; smokeLogPrivacy; Smoke log text privacy issue
GATEWAY_E2E_HISTORY_ERROR; GATEWAY_E2E_END_ERROR; SELF_TEST_STOP_ERROR
forbiddenTextFields
`);
  write(root, "scripts/lib/ios_nemotron_structured_smoke_summary.mjs", `
gatewayProvider; gatewayAsrProvider; gatewaySessionEventSink
	deviceAsrProvider; sourceLanguage; targetLanguage; translationAvailable; modelChunkMs; autoDownloadModel
audioSessionError; decoderReadyAfterStart
fluidAudioRuntimeAvailableAfterStart; modelScanStatusAfterStart
`);
  write(root, "scripts/lib/text_privacy_fields.mjs", `
receivedText
forbiddenTextFields
textPrivacyIssuesForJsonLines
`);
  write(root, "scripts/lib/ios_nemotron_smoke_result_requirements.mjs", `
COREML_NEMOTRON_SELF_TEST_RESULT
COREML_NEMOTRON_LOCAL_MVP_RESULT
segmentCount
translationFinal
iosNemotronRequiredRuntimeContract
summary.deviceAsrProvider !== contract.deviceAsrProvider
summary.modelChunkMs !== contract.modelChunkMs
summary.autoDownloadModel !== contract.autoDownloadModel; summary.sourceLanguage !== contract.sourceLanguage; summary.targetLanguage !== contract.targetLanguage
fluidAudioRuntimeAvailableAfterStart; decoderReadyAfterStart; modelScanStatusAfterStart
useLocalSessions
	onDeviceTranslationProvider; translationAvailable
localHistorySaved
historyStatus !== "ended"
`);
  write(root, "scripts/ios_nemotron_mvp_report.mjs", `
iosNemotronRequiredRuntimeContract
provisioningRepairEvidence.pass
signedBuildEvidence.pass
smokeEvidence.issues.length === 0
effectiveGatewayEvidence.issues.length === 0
no text/transcript/sourceText/translatedText fields
`);
  write(root, "scripts/lib/ios_nemotron_runtime_contract.mjs", `
deviceAsrProvider: "coreml_nemotron"
modelChunkMs: 2240
autoDownloadModel: false; sourceLanguage: "auto"; targetLanguage: "zh"
useLocalSessions: true; useOnDeviceTranslation: true; onDeviceTranslationProvider: "ios_system"; onDeviceTranslationRequired: true
gatewayProvider: "lmstudio"
gatewayAsrProvider: "mock"
gatewaySessionEventSink: "api"
`);
  write(root, "scripts/ios_nemotron_runtime_contract_env.mjs", `
iosNemotronRequiredRuntimeContract
IOS_NEMOTRON_CONTRACT_DEVICE_ASR_PROVIDER
IOS_NEMOTRON_CONTRACT_MODEL_CHUNK_MS
IOS_NEMOTRON_CONTRACT_AUTO_DOWNLOAD_MODEL; IOS_NEMOTRON_CONTRACT_SOURCE_LANGUAGE; IOS_NEMOTRON_CONTRACT_TARGET_LANGUAGE
IOS_NEMOTRON_CONTRACT_USE_LOCAL_SESSIONS; IOS_NEMOTRON_CONTRACT_USE_ON_DEVICE_TRANSLATION; IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_PROVIDER; IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_REQUIRED
IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER
IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER
IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK
`);
  write(root, "scripts/lib/ios_nemotron_acceptance_summary.mjs", `
requiredRuntimeContract
`);
  write(root, "scripts/lib/ios_nemotron_report_markdown.mjs", `
deviceAsrProvider=\${contractValue; sourceLanguage=\${contractValue; targetLanguage=\${contractValue
COREML_NEMOTRON_LOCAL_MVP_RESULT
localExportReady=true
`);
  return root;
}

function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
