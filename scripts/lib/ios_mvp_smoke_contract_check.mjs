import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function checkIosMvpSmokeContract(root) {
  const checks = [];
  requireContains(checks, root, "scripts/ios_nemotron_run_mvp.sh", [
    ["ios_nemotron_runtime_contract_env.mjs", "run loads required runtime contract"],
    [
      "RUNTIME_CONTRACT_ENV=\"$(node \"$ROOT_DIR/scripts/ios_nemotron_runtime_contract_env.mjs\")\"",
      "run fails if runtime contract export fails",
    ],
    ["eval \"$RUNTIME_CONTRACT_ENV\"", "run applies runtime contract env"],
    ["IOS_MVP_SMOKE_STEPS:-diagnostics,selftest,local_mvp", "run defaults to local MVP smoke steps"],
    ["DEVICE_ASR_AUTO_DOWNLOAD_MODEL:-$IOS_NEMOTRON_CONTRACT_AUTO_DOWNLOAD_MODEL", "run defaults to staged model from contract"],
    ["DEVICE_ASR_MODEL_CHUNK_MS:-$IOS_NEMOTRON_CONTRACT_MODEL_CHUNK_MS", "run defaults model chunk from contract"],
    ["SOURCE_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_SOURCE_LANGUAGE", "run defaults source language from contract"],
    ["TARGET_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_TARGET_LANGUAGE", "run defaults target language from contract"],
    ["USE_LOCAL_SESSIONS:-$IOS_NEMOTRON_CONTRACT_USE_LOCAL_SESSIONS", "run defaults local sessions from contract"],
    ["USE_ON_DEVICE_TRANSLATION:-$IOS_NEMOTRON_CONTRACT_USE_ON_DEVICE_TRANSLATION", "run defaults on-device translation from contract"],
    ["ON_DEVICE_TRANSLATION_PROVIDER:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_PROVIDER", "run defaults translation provider from contract"],
    ["ON_DEVICE_TRANSLATION_REQUIRED:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_REQUIRED", "run defaults translation fallback mode from contract"],
    ["REALTIME_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER", "run defaults Gateway provider from contract"],
    ["SESSION_EVENT_SINK:-$IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK", "run defaults history sink from contract"],
    ["ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER", "run defaults Gateway ASR provider from contract"],
    ["DEVICE_ASR_MODEL_CHUNK_MS=\"$DEVICE_ASR_MODEL_CHUNK_MS\"", "run passes model chunk to final smoke"],
    ["SOURCE_LANGUAGE=\"$SOURCE_LANGUAGE\"", "run passes source language to final smoke"],
    ["TARGET_LANGUAGE=\"$TARGET_LANGUAGE\"", "run passes target language to final smoke"],
    ["USE_LOCAL_SESSIONS=\"$USE_LOCAL_SESSIONS\"", "run passes local sessions to final smoke"],
    ["USE_ON_DEVICE_TRANSLATION=\"$USE_ON_DEVICE_TRANSLATION\"", "run passes on-device translation to final smoke"],
    ["ON_DEVICE_TRANSLATION_PROVIDER=\"$ON_DEVICE_TRANSLATION_PROVIDER\"", "run passes translation provider to final smoke"],
    ["ON_DEVICE_TRANSLATION_REQUIRED=\"$ON_DEVICE_TRANSLATION_REQUIRED\"", "run passes translation fallback mode to final smoke"],
    ["REALTIME_PROVIDER=\"$REALTIME_PROVIDER\"", "run passes Gateway provider to services/status/smoke"],
    ["ASR_PROVIDER=\"$ASR_PROVIDER\"", "run passes Gateway ASR provider to services/status/smoke"],
    ["SESSION_EVENT_SINK=\"$SESSION_EVENT_SINK\"", "run passes history sink to status/smoke"],
    ["IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD=true", "run requires signed build preflight"],
    ["diagnose_ios_device.mjs", "run checks physical iPhone readiness"],
    ["ios_nemotron_repair_provisioning.sh", "run repairs provisioning"],
    ["ios_nemotron_local_preflight.sh", "run refreshes local preflight"],
    ["ios_nemotron_start_services.sh", "run starts API/Gateway services"],
    ["ios_nemotron_mvp_status.mjs\" --strict", "run enforces strict status before smoke"],
    ["ios_nemotron_mvp_smoke.sh", "run invokes MVP smoke"],
    ["ios_nemotron_mvp_report.mjs", "run refreshes acceptance report"],
  ]);
  requireContains(checks, root, "scripts/ios_nemotron_mvp_smoke.sh", [
    ["ios_nemotron_runtime_contract_env.mjs", "smoke loads required runtime contract"],
    [
      "RUNTIME_CONTRACT_ENV=\"$(node \"$ROOT_DIR/scripts/ios_nemotron_runtime_contract_env.mjs\")\"",
      "smoke fails if runtime contract export fails",
    ],
    ["eval \"$RUNTIME_CONTRACT_ENV\"", "smoke applies runtime contract env"],
    ["DEVICE_ASR_AUTO_DOWNLOAD_MODEL:-$IOS_NEMOTRON_CONTRACT_AUTO_DOWNLOAD_MODEL", "smoke defaults to staged model from contract"],
    ["DEVICE_ASR_MODEL_CHUNK_MS:-$IOS_NEMOTRON_CONTRACT_MODEL_CHUNK_MS", "smoke defaults model chunk from contract"],
    ["SOURCE_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_SOURCE_LANGUAGE", "smoke defaults source language from contract"],
    ["TARGET_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_TARGET_LANGUAGE", "smoke defaults target language from contract"],
    ["USE_LOCAL_SESSIONS:-$IOS_NEMOTRON_CONTRACT_USE_LOCAL_SESSIONS", "smoke defaults local sessions from contract"],
    ["USE_ON_DEVICE_TRANSLATION:-$IOS_NEMOTRON_CONTRACT_USE_ON_DEVICE_TRANSLATION", "smoke defaults on-device translation from contract"],
    ["ON_DEVICE_TRANSLATION_PROVIDER:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_PROVIDER", "smoke defaults translation provider from contract"],
    ["ON_DEVICE_TRANSLATION_REQUIRED:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_REQUIRED", "smoke defaults translation fallback mode from contract"],
    ["REALTIME_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER", "smoke defaults Gateway provider from contract"],
    ["ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER", "smoke defaults Gateway ASR provider from contract"],
    ["SESSION_EVENT_SINK:-$IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK", "smoke defaults history sink from contract"],
    ["EXPECTED_GATEWAY_PROVIDER:-$REALTIME_PROVIDER", "smoke derives expected Gateway provider"],
    ["EXPECTED_GATEWAY_ASR_PROVIDER:-$ASR_PROVIDER", "smoke derives expected Gateway ASR provider"],
    ["EXPECTED_GATEWAY_SESSION_EVENT_SINK:-$SESSION_EVENT_SINK", "smoke checks configured history sink"],
    ["DEVICE_ASR_PREPARE_MODEL:-true", "smoke prepares model in diagnostics"],
    ["DEVICE_ASR_SELF_TEST_SECONDS:-20", "smoke gives microphone selftest time"],
    ["DEVICE_ASR_E2E_SECONDS:-45", "smoke gives local MVP time"],
    ["DEVICE_ASR_MODEL_CHUNK_MS=\"$DEVICE_ASR_MODEL_CHUNK_MS\"", "smoke passes required model chunk"],
    ["SOURCE_LANGUAGE=\"$SOURCE_LANGUAGE\"", "smoke passes source language"],
    ["TARGET_LANGUAGE=\"$TARGET_LANGUAGE\"", "smoke passes target language"],
    ["USE_LOCAL_SESSIONS=\"$USE_LOCAL_SESSIONS\"", "smoke passes local sessions"],
    ["USE_ON_DEVICE_TRANSLATION=\"$USE_ON_DEVICE_TRANSLATION\"", "smoke passes on-device translation"],
    ["ON_DEVICE_TRANSLATION_PROVIDER=\"$ON_DEVICE_TRANSLATION_PROVIDER\"", "smoke passes translation provider"],
    ["ON_DEVICE_TRANSLATION_REQUIRED=\"$ON_DEVICE_TRANSLATION_REQUIRED\"", "smoke passes translation fallback mode"],
    ["IOS_SMOKE_MODE=mvp", "smoke supports combined MVP run"],
    ["check_ios_runtime_permissions.mjs", "smoke checks iOS permissions"],
    ["diagnose_ios_device.mjs", "smoke checks physical iPhone readiness"],
    ["check_e2e_services", "smoke prechecks API/Gateway services"],
    ["health.realtimeWsEndpoint !== expected", "smoke checks API Gateway endpoint"],
    ["health.provider !== expectedProvider", "smoke checks Gateway translation provider"],
    ["health.asrProvider !== expectedAsrProvider", "smoke checks Gateway ASR provider"],
    ["health.sessionEventSink !== expectedSessionEventSink", "smoke checks server-owned history sink"],
  ]);
  requireContains(checks, root, "scripts/ios_nemotron_device_smoke.sh", [
    ["ios_nemotron_runtime_contract_env.mjs", "device smoke loads required runtime contract"],
    [
      "RUNTIME_CONTRACT_ENV=\"$(node \"$ROOT_DIR/scripts/ios_nemotron_runtime_contract_env.mjs\")\"",
      "device smoke fails if runtime contract export fails",
    ],
    ["eval \"$RUNTIME_CONTRACT_ENV\"", "device smoke applies runtime contract env"],
    ["ALLOW_IOS_SIMULATOR:-false", "device smoke defaults to real iPhone only"],
    ["DEVICE_ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_DEVICE_ASR_PROVIDER", "device smoke defaults Core ML Nemotron provider from contract"],
    ["DEVICE_ASR_AUTO_DOWNLOAD_MODEL:-$IOS_NEMOTRON_CONTRACT_AUTO_DOWNLOAD_MODEL", "device smoke defaults staged model from contract"],
    ["DEVICE_ASR_MODEL_CHUNK_MS:-$IOS_NEMOTRON_CONTRACT_MODEL_CHUNK_MS", "device smoke defaults model chunk from contract"],
    ["SOURCE_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_SOURCE_LANGUAGE", "device smoke defaults source language from contract"],
    ["TARGET_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_TARGET_LANGUAGE", "device smoke defaults target language from contract"],
    ["USE_LOCAL_SESSIONS:-$IOS_NEMOTRON_CONTRACT_USE_LOCAL_SESSIONS", "device smoke defaults local sessions from contract"],
    ["USE_ON_DEVICE_TRANSLATION:-$IOS_NEMOTRON_CONTRACT_USE_ON_DEVICE_TRANSLATION", "device smoke defaults on-device translation from contract"],
    ["ON_DEVICE_TRANSLATION_PROVIDER:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_PROVIDER", "device smoke defaults translation provider from contract"],
    ["ON_DEVICE_TRANSLATION_REQUIRED:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_REQUIRED", "device smoke defaults translation fallback mode from contract"],
    ["EXPECTED_GATEWAY_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER", "device smoke defaults expected Gateway provider from contract"],
    ["EXPECTED_GATEWAY_ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER", "device smoke defaults expected Gateway ASR provider from contract"],
    ["EXPECTED_GATEWAY_SESSION_EVENT_SINK:-$IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK", "device smoke defaults expected history sink from contract"],
    ["DEVICE_ASR_EXPECT_SEGMENT:-true", "device smoke expects microphone ASR text"],
    ["DEVICE_ASR_EXPECT_TRANSLATION:-true", "device smoke expects translation"],
    ["validate_ios_nemotron_bundle.mjs", "device smoke validates staged model"],
    ["select_flutter_ios_device.mjs", "device smoke uses shared Flutter iOS selector"],
    ["--dart-define=USE_DEVICE_ASR=true", "device smoke enables device ASR"],
    ["--dart-define=DEVICE_ASR_PROVIDER=\"$DEVICE_ASR_PROVIDER\"", "device smoke passes selected ASR provider"],
    ["--dart-define=SOURCE_LANGUAGE=\"$SOURCE_LANGUAGE\"", "device smoke passes source language"],
    ["--dart-define=TARGET_LANGUAGE=\"$TARGET_LANGUAGE\"", "device smoke passes target language"],
    ["--dart-define=USE_LOCAL_SESSIONS=\"$USE_LOCAL_SESSIONS\"", "device smoke passes local sessions"],
    ["--dart-define=USE_ON_DEVICE_TRANSLATION=\"$USE_ON_DEVICE_TRANSLATION\"", "device smoke enables on-device translation"],
    ["--dart-define=ON_DEVICE_TRANSLATION_PROVIDER=\"$ON_DEVICE_TRANSLATION_PROVIDER\"", "device smoke passes translation provider"],
    ["--dart-define=ON_DEVICE_TRANSLATION_REQUIRED=\"$ON_DEVICE_TRANSLATION_REQUIRED\"", "device smoke passes translation fallback mode"],
    ["--dart-define=EXPECTED_GATEWAY_PROVIDER=\"$EXPECTED_GATEWAY_PROVIDER\"", "device smoke passes expected Gateway provider"],
    ["--dart-define=EXPECTED_GATEWAY_ASR_PROVIDER=\"$EXPECTED_GATEWAY_ASR_PROVIDER\"", "device smoke passes expected Gateway ASR provider"],
    ["--dart-define=EXPECTED_GATEWAY_SESSION_EVENT_SINK=\"$EXPECTED_GATEWAY_SESSION_EVENT_SINK\"", "device smoke passes expected history sink"],
    ["integration_test/core_ml_nemotron_mvp_test.dart", "device smoke runs combined MVP integration test"],
    ["--dart-define=SERVER_OWNED_HISTORY=\"$SERVER_OWNED_HISTORY\"", "device smoke passes history mode"],
  ]);
  requireContains(checks, root, "scripts/select_flutter_ios_device.mjs", [
    ["selectFlutterIosDevice", "device selector CLI uses shared selector"],
    ["ALLOW_IOS_SIMULATOR", "device selector CLI honors simulator dry-run flag"],
    ["process.exit(2)", "device selector CLI fails closed"],
  ]);
  requireContains(checks, root, "scripts/lib/flutter_ios_device_selector.mjs", [
    ["minIosMajor ?? 17", "device selector requires iOS 17 or newer by default"],
    ["targetPlatform === \"ios\"", "device selector filters iOS devices"],
    ["allowSimulator || !device.emulator", "device selector rejects simulators by default"],
    ["requires iOS", "device selector explains iOS version failures"],
  ]);
  requireContains(checks, root, "apps/mobile/integration_test/core_ml_nemotron_mvp_test.dart", [
    ["diagnostics.main()", "MVP test runs diagnostics"],
    ["self_test.main()", "MVP test runs microphone selftest"],
    ["local_mvp.main()", "MVP test runs local on-device MVP"],
  ]);
  requireContains(checks, root, "apps/mobile/integration_test/core_ml_nemotron_self_test.dart", [
    ["'DEVICE_ASR_EXPECT_SEGMENT'", "selftest exposes segment expectation"],
    ["defaultValue: true", "selftest expects segment by default"],
    ["'deviceAsrProvider': 'coreml_nemotron'", "selftest records Core ML Nemotron provider"],
    ["'modelChunkMs': modelChunkMs", "selftest records Nemotron model chunk"],
    ["'autoDownloadModel': autoDownloadModel", "selftest records staged/download mode"],
    ["COREML_NEMOTRON_SELF_TEST_SEGMENT", "selftest logs ASR segment marker"],
    ["coreMlNemotronAudioCaptureIssue", "selftest diagnoses missing microphone audio"],
    ["_deviceAsrStopDrain", "selftest drains ASR stop tail events"],
    ["COREML_NEMOTRON_SELF_TEST_RESULT", "selftest logs structured result"],
  ]);
  requireContains(checks, root, "apps/mobile/integration_test/core_ml_nemotron_local_mvp_test.dart", [
    ["'DEVICE_ASR_EXPECT_TRANSLATION'", "e2e exposes translation expectation"],
    ["defaultValue: true", "e2e expects translation by default"],
    ["RealtimeController(", "local MVP uses app realtime controller"],
    ["SessionHistoryRepository.fromConfig", "local MVP reads app history"],
    ["LocalSessionStore", "local MVP verifies Markdown export"],
    ["'deviceAsrProvider': 'coreml_nemotron'", "e2e records Core ML Nemotron provider"],
    ["'sourceLanguage': appConfig.sourceLanguage", "e2e records configured source language"],
    ["'targetLanguage': appConfig.targetLanguage", "e2e records configured target language"],
    ["modelChunkMs: modelChunkMs", "e2e records Nemotron model chunk"],
    ["autoDownloadModel: autoDownloadModel", "e2e records staged/download mode"],
    ["_deviceAsrStopDrain", "e2e drains ASR stop tail events"],
    ["translationAvailability", "e2e records on-device translation availability"],
    ["translationFinal", "e2e requires translation final"],
    ["localHistorySaved", "e2e checks history saved"],
    ["localExportReady", "e2e checks Markdown export"],
    ["expect(historyStatus, 'ended')", "e2e checks ended history"],
    ["COREML_NEMOTRON_LOCAL_MVP_RESULT", "e2e logs structured result"],
  ]);
  requireContains(checks, root, "apps/mobile/integration_test/core_ml_nemotron_gateway_e2e_support.dart", [
    ["'EXPECTED_GATEWAY_PROVIDER'", "e2e support reads expected Gateway provider"],
    ["'EXPECTED_GATEWAY_ASR_PROVIDER'", "e2e support reads expected Gateway ASR provider"],
    ["'EXPECTED_GATEWAY_SESSION_EVENT_SINK'", "e2e support reads expected history sink"],
    ["'sourceLanguage': sourceLanguage", "e2e support exports source language"],
    ["'targetLanguage': targetLanguage", "e2e support exports target language"],
    ["gatewayHealthRoutingError", "e2e support exposes routing validation helper"],
  ]);
  requireContains(checks, root, "apps/mobile/integration_test/core_ml_nemotron_model_scan_log.dart", [
    ["Device ASR audio session failed", "smoke diagnoses audio session failure"],
    ["audio.sessionError=", "smoke reports audio session error detail"],
    ["Device ASR did not receive microphone audio", "smoke still diagnoses missing microphone audio"],
  ]);
  requireContains(checks, root, "apps/mobile/lib/src/features/device_asr/data/core_ml_nemotron_diagnostics_report.dart", [
    ["textCharCount", "diagnostics report exports selftest text length"],
    ["segment.text.length", "diagnostics report derives selftest text length"],
  ]);
  requireNotContains(checks, root, "apps/mobile/lib/src/features/device_asr/data/core_ml_nemotron_diagnostics_report.dart", [
    ["'text': segment.text", "diagnostics report does not export selftest text"],
  ]);
  requireContains(checks, root, "apps/mobile/lib/src/features/realtime/presentation/controllers/realtime_controller.dart", [
    ["_deviceAsrStopDrain", "controller drains native ASR stop tail events"],
    ["await _drainDeviceAsrStopEvents();", "controller drains before canceling ASR subscription"],
  ]);
  requireContains(checks, root, "scripts/lib/ios_nemotron_report_evidence.mjs", [
    ["smokeStructuredResultIssues", "report derives issues from structured smoke results"],
    ["COREML_NEMOTRON_SELF_TEST_SEGMENT", "report checks selftest segment marker"],
    ["COREML_NEMOTRON_LOCAL_MVP_RESULT", "report checks local MVP result marker"],
    ["COREML_NEMOTRON_LOCAL_MVP_HISTORY", "report checks local history marker"],
    ["summarizeSelfTestResult", "report summarizes selftest structured result"],
    ["summarizeLocalMvpResult", "report summarizes local MVP structured result"],
    ["LOCAL_MVP_HISTORY_ERROR", "report captures local history errors"],
    ["smokeLogPrivacy", "report checks smoke log text privacy"],
    ["Smoke log text privacy issue", "report surfaces smoke text privacy issue"],
    ["GATEWAY_E2E_HISTORY_ERROR", "report captures Gateway history errors"],
    ["GATEWAY_E2E_END_ERROR", "report captures Gateway end errors"],
    ["SELF_TEST_STOP_ERROR", "report captures selftest stop errors"],
    ["forbiddenTextFields", "report recursively checks Gateway text privacy"],
  ]);
  requireContains(checks, root, "scripts/lib/ios_nemotron_structured_smoke_summary.mjs", [
    ["gatewayProvider", "report summarizes Gateway provider"],
    ["gatewayAsrProvider", "report summarizes Gateway ASR provider"],
    ["gatewaySessionEventSink", "report summarizes Gateway history sink"],
    ["deviceAsrProvider", "report summarizes device ASR provider"],
    ["sourceLanguage", "report summarizes source language"],
    ["targetLanguage", "report summarizes target language"],
    ["translationAvailable", "report summarizes on-device translation availability"],
    ["modelChunkMs", "report summarizes Nemotron model chunk"],
    ["autoDownloadModel", "report summarizes staged/download mode"],
    ["audioSessionError", "report summarizes audio session error"],
    ["decoderReadyAfterStart", "report summarizes Core ML decoder readiness"],
    ["fluidAudioRuntimeAvailableAfterStart", "report summarizes FluidAudio runtime readiness"],
    ["modelScanStatusAfterStart", "report summarizes started model scan status"],
  ]);
  requireContains(checks, root, "scripts/lib/text_privacy_fields.mjs", [
    ["receivedText", "privacy helper blocks received text"],
    ["forbiddenTextFields", "privacy helper exports recursive field check"],
    ["textPrivacyIssuesForJsonLines", "privacy helper scans structured log lines"],
  ]);
  requireContains(checks, root, "scripts/lib/ios_nemotron_smoke_result_requirements.mjs", [
    ["COREML_NEMOTRON_SELF_TEST_RESULT", "structured requirements check selftest result"],
    ["COREML_NEMOTRON_LOCAL_MVP_RESULT", "structured requirements check local MVP result"],
    ["segmentCount", "structured requirements require ASR segments"],
    ["translationFinal", "structured requirements require translation final"],
    ["iosNemotronRequiredRuntimeContract", "structured requirements use required runtime contract"],
    ["summary.deviceAsrProvider !== contract.deviceAsrProvider", "structured requirements require Core ML Nemotron provider"],
    ["summary.modelChunkMs !== contract.modelChunkMs", "structured requirements require 2240ms Nemotron chunk"],
    ["summary.autoDownloadModel !== contract.autoDownloadModel", "structured requirements require staged Nemotron model"],
    ["fluidAudioRuntimeAvailableAfterStart", "structured requirements require FluidAudio runtime"],
    ["decoderReadyAfterStart", "structured requirements require Core ML decoder ready"],
    ["modelScanStatusAfterStart", "structured requirements require started model scan ready"],
    ["summary.sourceLanguage !== contract.sourceLanguage", "structured requirements require source language"],
    ["summary.targetLanguage !== contract.targetLanguage", "structured requirements require target language"],
    ["useLocalSessions", "structured requirements require local sessions"],
    ["onDeviceTranslationProvider", "structured requirements require on-device translation provider"],
    ["translationAvailable", "structured requirements require on-device translation availability"],
    ["localHistorySaved", "structured requirements require saved history"],
    ["historyStatus !== \"ended\"", "structured requirements require ended history"],
  ]);
  requireContains(checks, root, "scripts/ios_nemotron_mvp_report.mjs", [
    ["iosNemotronRequiredRuntimeContract", "report passes required runtime contract"],
    ["provisioningRepairEvidence.pass", "report ready requires provisioning repair evidence"],
    ["signedBuildEvidence.pass", "report ready requires signed build evidence"],
    ["smokeEvidence.issues.length === 0", "report ready requires clean smoke issues"],
    ["effectiveGatewayEvidence.issues.length === 0", "report ready handles optional Gateway issues"],
    ["no text/transcript/sourceText/translatedText fields", "report names full Gateway privacy field set"],
  ]);
  requireContains(checks, root, "scripts/lib/ios_nemotron_runtime_contract.mjs", [
    ["deviceAsrProvider: \"coreml_nemotron\"", "runtime contract requires Core ML Nemotron provider"],
    ["modelChunkMs: 2240", "runtime contract requires 2240ms Nemotron chunk"],
    ["autoDownloadModel: false", "runtime contract requires staged Nemotron model"],
    ["sourceLanguage: \"auto\"", "runtime contract requires auto source language"],
    ["targetLanguage: \"zh\"", "runtime contract requires Chinese target language"],
    ["useLocalSessions: true", "runtime contract enables local sessions"],
    ["useOnDeviceTranslation: true", "runtime contract enables on-device translation"],
    ["onDeviceTranslationProvider: \"ios_system\"", "runtime contract requires iOS system translation"],
    ["onDeviceTranslationRequired: true", "runtime contract requires local on-device translation"],
    ["gatewayProvider: \"lmstudio\"", "runtime contract requires LM Studio provider"],
    ["gatewayAsrProvider: \"mock\"", "runtime contract requires device-ASR text route"],
    ["gatewaySessionEventSink: \"api\"", "runtime contract requires API history sink"],
  ]);
  requireContains(checks, root, "scripts/ios_nemotron_runtime_contract_env.mjs", [
    ["iosNemotronRequiredRuntimeContract", "contract env imports required runtime contract"],
    ["IOS_NEMOTRON_CONTRACT_DEVICE_ASR_PROVIDER", "contract env exports ASR provider"],
    ["IOS_NEMOTRON_CONTRACT_MODEL_CHUNK_MS", "contract env exports model chunk"],
    ["IOS_NEMOTRON_CONTRACT_AUTO_DOWNLOAD_MODEL", "contract env exports staged/download mode"],
    ["IOS_NEMOTRON_CONTRACT_SOURCE_LANGUAGE", "contract env exports source language"],
    ["IOS_NEMOTRON_CONTRACT_TARGET_LANGUAGE", "contract env exports target language"],
    ["IOS_NEMOTRON_CONTRACT_USE_LOCAL_SESSIONS", "contract env exports local sessions"],
    ["IOS_NEMOTRON_CONTRACT_USE_ON_DEVICE_TRANSLATION", "contract env exports on-device translation"],
    ["IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_PROVIDER", "contract env exports translation provider"],
    ["IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_REQUIRED", "contract env exports translation fallback mode"],
    ["IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER", "contract env exports Gateway provider"],
    ["IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER", "contract env exports Gateway ASR provider"],
    ["IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK", "contract env exports Gateway history sink"],
  ]);
  requireContains(checks, root, "scripts/lib/ios_nemotron_acceptance_summary.mjs", [
    ["requiredRuntimeContract", "JSON summary exports required runtime contract"],
  ]);
  requireContains(checks, root, "scripts/lib/ios_nemotron_report_markdown.mjs", [
    ["deviceAsrProvider=${contractValue", "Markdown report documents required ASR provider"],
    ["sourceLanguage=${contractValue", "Markdown report documents required source language"],
    ["targetLanguage=${contractValue", "Markdown report documents required target language"],
    ["COREML_NEMOTRON_LOCAL_MVP_RESULT", "Markdown report documents local MVP result"],
    ["localExportReady=true", "Markdown report documents local export proof"],
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

function requireNotContains(checks, root, relativePath, definitions) {
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
    const pass = !content.includes(needle);
    checks.push({
      file: relativePath,
      label,
      pass,
      issue: pass ? null : `${relativePath} must not contain ${needle}`,
    });
  }
}
