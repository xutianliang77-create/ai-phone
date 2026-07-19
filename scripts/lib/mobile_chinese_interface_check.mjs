import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function checkMobileChineseInterface(root) {
  const checks = [];
  requireContains(checks, root, "apps/mobile/lib/src/app/app.dart", [
    ["this.locale = const Locale('zh')", "Flutter app defaults to Chinese"],
    ["return const Locale('zh')", "unsupported locales fall back to Chinese"],
  ]);
  requireContains(
    checks,
    root,
    "apps/mobile/lib/src/app/localization/app_localization_texts.dart",
    [
      ["ai phone", "English product app title exists"],
      ["中英实时同声传译", "Chinese realtime subtitle exists"],
      ["英译中", "Chinese English-to-Chinese direction label exists"],
      ["中译英", "Chinese Chinese-to-English direction label exists"],
      ["历史记录", "Chinese history label exists"],
      ["模型链路诊断", "Chinese model diagnostics label exists"],
      ["正在准备端侧 ASR 模型", "Chinese device-ASR runtime status exists"],
      ["正在启动本地会话", "Chinese local session start status exists"],
      ["端侧翻译", "Chinese on-device translation section exists"],
      ["端侧翻译暂不可用", "Chinese on-device translation failure exists"],
      ["语言包未安装", "Chinese translation language pack issue exists"],
      ["实时连接已断开", "Chinese realtime disconnect status exists"],
      ["本次会话已达到时长上限", "Chinese session timeout status exists"],
      ["API 历史同步", "Chinese gateway event sink value exists"],
      ["iOS 音频会话启动失败", "Chinese audio session hint exists"],
      ["ASR 模型处理音频失败", "Chinese ASR processing error hint exists"],
      ["端侧 ASR 启动失败", "Chinese device-ASR start failure exists"],
      ["未收到麦克风输入", "Chinese microphone diagnostic issue exists"],
    ],
  );
  requireContains(
    checks,
    root,
    "apps/mobile/lib/src/app/localization/app_localizations.dart",
    [
      ["Locale('zh')", "Chinese locale is supported"],
      ["Locale('en')", "English locale remains available"],
      ["appLocalizationTexts", "Flutter localization uses shared text table"],
      ["zhDiagnosticsLabels", "diagnostic labels use Chinese map"],
      ["zhDiagnosticsValues", "diagnostic values use Chinese map"],
      ["zhRuntimeMessages", "runtime messages use Chinese map"],
      ["创建实时会话失败", "Chinese session error exists"],
      ["端侧 ASR 当前不可用", "Chinese device-ASR unavailable status exists"],
      ["Device ASR processing failed", "Device-ASR processing failure is localized"],
      ["端侧 ASR 诊断", "Chinese device-ASR diagnostic failure exists"],
    ],
  );
  requireContains(checks, root, "apps/mobile/test/widget_test.dart", [
    ["falls back to Chinese for unsupported system locale", "Chinese fallback widget test exists"],
    ["switches interface language from home toolbar", "language switch widget test exists"],
    ["localizes realtime status bar API errors", "status bar API error widget test exists"],
    ["localizes diagnostic values and user-facing errors", "Chinese diagnostics widget test exists"],
    ["keeps runtime and diagnostics messages Chinese by default", "Chinese runtime message test exists"],
    ["Device ASR processing failed: FluidAudio process failed", "Device-ASR processing failure widget assertion exists"],
    ["Device ASR diagnostic: no_microphone_input", "Device-ASR diagnostic widget assertion exists"],
  ]);
  requireContains(
    checks,
    root,
    "apps/mobile/test/realtime_settings_menu_test.dart",
    [
      ["源语言", "Chinese source language setting widget assertion exists"],
      ["自动识别", "Chinese auto language widget assertion exists"],
      ["目标语言", "Chinese target language setting widget assertion exists"],
      ["自动反向", "Chinese auto reverse target widget assertion exists"],
      ["自动朗读译文", "Chinese translation speech toggle widget assertion exists"],
    ],
  );
  requireContains(
    checks,
    root,
    "apps/mobile/lib/src/features/realtime/presentation/widgets/realtime_status_bar.dart",
    [
      ["l10n.errorMessage(message!)", "realtime status bar localizes user-facing messages"],
    ],
  );
  requireContains(
    checks,
    root,
    "apps/mobile/lib/src/features/device_asr/presentation/widgets/core_ml_nemotron_diagnostics_widgets.dart",
    [
      ["l10n.runtimeMessage(message!)", "self-test panel localizes runtime messages"],
      ["l10n.runtimeMessage(availability.message)", "availability rows localize runtime messages"],
    ],
  );
  requireContains(
    checks,
    root,
    "apps/mobile/lib/src/features/device_asr/data/core_ml_nemotron_audio_diagnostic.dart",
    [
      ["audio_session_error", "audio session error diagnostic issue exists"],
      ["_hasText(audio['sessionError'])", "audio session error takes priority"],
    ],
  );
  requireContains(
    checks,
    root,
    "apps/mobile/lib/src/features/device_asr/presentation/widgets/core_ml_nemotron_audio_stats_rows.dart",
    [
      ["'sessionError'", "audio session error row is displayed"],
      ["l10n.audioSessionErrorHint", "audio session error hint is localized"],
      ["l10n.asrProcessingErrorHint", "ASR processing error hint is localized"],
    ],
  );
  requireContains(
    checks,
    root,
    "apps/mobile/test/core_ml_nemotron_audio_stats_rows_test.dart",
    [
      ["shows audio session error before microphone hint", "audio session error widget test exists"],
      ["iOS 音频会话启动失败", "audio session error Chinese widget assertion exists"],
    ],
  );
  requireContains(
    checks,
    root,
    "apps/mobile/test/core_ml_nemotron_diagnostics_failure_test.dart",
    [
      ["refreshes audio session diagnostics after self-test start fails", "self-test start failure refreshes diagnostics"],
      ["nativeAvailability", "self-test failure test expects native diagnostics refresh"],
      ["audio_session_error", "self-test failure export keeps audio diagnostic issue"],
      ["native start failed", "self-test failure export keeps start error"],
    ],
  );
  requireContains(checks, root, "apps/mobile/ios/Runner/zh-Hans.lproj/InfoPlist.strings", [
    ["\"CFBundleDisplayName\" = \"ai phone\"", "iOS display name uses ai phone"],
    ["\"NSMicrophoneUsageDescription\"", "iOS Chinese microphone permission exists"],
    ["\"NSLocalNetworkUsageDescription\"", "iOS Chinese local network permission exists"],
  ]);
  requireContains(checks, root, "apps/mobile/android/app/src/main/res/values/strings.xml", [
    ["<string name=\"app_name\">ai phone</string>", "Android default app name uses ai phone"],
  ]);
  requireContains(checks, root, "apps/mobile/android/app/src/main/res/values-zh/strings.xml", [
    ["<string name=\"app_name\">ai phone</string>", "Android zh app name uses ai phone"],
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
    checks.push({
      file: relativePath,
      label,
      pass: content.includes(needle),
      issue: content.includes(needle) ? null : `${relativePath} missing ${needle}`,
    });
  }
}
