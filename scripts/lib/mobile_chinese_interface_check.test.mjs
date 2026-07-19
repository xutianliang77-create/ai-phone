import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkMobileChineseInterface } from "./mobile_chinese_interface_check.mjs";

let tempDir = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("checkMobileChineseInterface", () => {
  test("passes when required Chinese interface evidence is present", () => {
    tempDir = makeProject();

    expect(checkMobileChineseInterface(tempDir)).toMatchObject({
      status: "ready",
      failures: [],
    });
  });

  test("fails when Chinese fallback evidence is missing", () => {
    tempDir = makeProject({
      appDart: "class TranslationApp { const TranslationApp(); }",
    });

    const result = checkMobileChineseInterface(tempDir);

    expect(result.status).toBe("not_ready");
    expect(result.failures.map((failure) => failure.label)).toContain(
      "Flutter app defaults to Chinese",
    );
  });

  test("fails when Chinese runtime message evidence is missing", () => {
    tempDir = makeProject({
      localizationTextsDart: "const appTitle = 'ai phone';",
    });

    const result = checkMobileChineseInterface(tempDir);

    expect(result.status).toBe("not_ready");
    expect(result.failures.map((failure) => failure.label)).toContain(
      "Chinese realtime disconnect status exists",
    );
  });

  test("fails when realtime status bar does not localize API errors", () => {
    tempDir = makeProject({
      realtimeStatusBarDart: "Text(message);",
    });

    const result = checkMobileChineseInterface(tempDir);

    expect(result.status).toBe("not_ready");
    expect(result.failures.map((failure) => failure.label)).toContain(
      "realtime status bar localizes user-facing messages",
    );
  });
});

function makeProject(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mobile-chinese-"));
  write(root, "apps/mobile/lib/src/app/app.dart", overrides.appDart ?? `
class TranslationApp {
  const TranslationApp({this.locale = const Locale('zh')});
  Object resolve() {
    return const Locale('zh');
  }
}
`);
  write(root, "apps/mobile/lib/src/app/localization/app_localization_texts.dart", overrides.localizationTextsDart ?? `
const locales = [Locale('zh'), Locale('en')];
const appTitle = 'ai phone';
const subtitle = '中英实时同声传译';
const toChinese = '英译中';
const toEnglish = '中译英';
const history = '历史记录';
const deviceAsr = '模型链路诊断';
const preparing = '正在准备端侧 ASR 模型';
const localSession = '正在启动本地会话';
const translationSection = '端侧翻译';
const localTranslation = '端侧翻译暂不可用';
const translationLanguagePack = '语言包未安装';
const disconnected = '实时连接已断开';
const timeout = '本次会话已达到时长上限';
const eventSink = 'API 历史同步';
const audioSessionHint = 'iOS 音频会话启动失败';
const processingHint = 'ASR 模型处理音频失败';
const startFailure = '端侧 ASR 启动失败';
const microphoneIssue = '未收到麦克风输入';
`);
  write(root, "apps/mobile/lib/src/app/localization/app_localizations.dart", overrides.localizationsDart ?? `
const locales = [Locale('zh'), Locale('en')];
const texts = appLocalizationTexts;
const labels = zhDiagnosticsLabels;
const values = zhDiagnosticsValues;
const runtime = zhRuntimeMessages;
const error = '创建实时会话失败';
const unavailable = '端侧 ASR 当前不可用';
const processing = 'Device ASR processing failed';
const startFailed = '端侧 ASR 启动失败';
const diagnosticFailed = '端侧 ASR 诊断';
`);
  write(root, "apps/mobile/test/widget_test.dart", `
testWidgets('falls back to Chinese for unsupported system locale', (_) {});
testWidgets('switches interface language from home toolbar', (_) {});
testWidgets('localizes realtime status bar API errors', (_) {});
test('localizes diagnostic values and user-facing errors', () {});
test('keeps runtime and diagnostics messages Chinese by default', () {});
expect('Device ASR processing failed: FluidAudio process failed', isNotEmpty);
expect('Device ASR diagnostic: no_microphone_input', isNotEmpty);
`);
  write(root, "apps/mobile/test/realtime_settings_menu_test.dart", `
expect('源语言', isNotEmpty);
expect('自动识别', isNotEmpty);
expect('目标语言', isNotEmpty);
expect('自动反向', isNotEmpty);
expect('自动朗读译文', isNotEmpty);
`);
  write(root, "apps/mobile/lib/src/features/realtime/presentation/widgets/realtime_status_bar.dart", overrides.realtimeStatusBarDart ?? `
Text(l10n.errorMessage(message!));
`);
  write(root, "apps/mobile/lib/src/features/device_asr/presentation/widgets/core_ml_nemotron_diagnostics_widgets.dart", `
Text(l10n.runtimeMessage(message!));
Text(l10n.runtimeMessage(availability.message));
`);
  write(root, "apps/mobile/lib/src/features/device_asr/data/core_ml_nemotron_audio_diagnostic.dart", `
if (_hasText(audio['sessionError'])) return 'audio_session_error';
`);
  write(root, "apps/mobile/lib/src/features/device_asr/presentation/widgets/core_ml_nemotron_audio_stats_rows.dart", `
const keys = ['sessionError'];
final hint = l10n.audioSessionErrorHint;
final processingHint = l10n.asrProcessingErrorHint;
`);
  write(root, "apps/mobile/test/core_ml_nemotron_audio_stats_rows_test.dart", `
testWidgets('shows audio session error before microphone hint', (_) {
  expect('iOS 音频会话启动失败', isNotEmpty);
});
`);
  write(root, "apps/mobile/test/core_ml_nemotron_diagnostics_failure_test.dart", `
testWidgets('refreshes audio session diagnostics after self-test start fails', (_) {
  expect('nativeAvailability', isNotEmpty);
  expect('audio_session_error', isNotEmpty);
  expect('native start failed', isNotEmpty);
});
`);
  write(root, "apps/mobile/ios/Runner/zh-Hans.lproj/InfoPlist.strings", `
"CFBundleDisplayName" = "ai phone";
"NSMicrophoneUsageDescription" = "ai phone 需要使用麦克风。";
"NSLocalNetworkUsageDescription" = "ai phone 需要连接局域网。";
`);
  write(root, "apps/mobile/android/app/src/main/res/values/strings.xml", `
<resources><string name="app_name">ai phone</string></resources>
`);
  write(root, "apps/mobile/android/app/src/main/res/values-zh/strings.xml", `
<resources><string name="app_name">ai phone</string></resources>
`);
  return root;
}

function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
