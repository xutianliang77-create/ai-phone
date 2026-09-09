import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app.dart';
import 'package:translation_mobile/src/app/app_language.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/compliance/data/compliance_consent_store.dart';
import 'package:translation_mobile/src/features/compliance/data/consent_audit_uploader.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_settings_store.dart';
import 'package:translation_mobile/src/features/realtime/data/voice_preset_catalog.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/pages/realtime_page.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_language_menu.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_resource_preparation_panel.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_settings_sheet.dart';
import 'package:translation_mobile/src/features/shell/presentation/pages/main_shell_page.dart';

import 'helpers/realtime_resource_fakes.dart';

void main() {
  for (final baseLocal in [true, false]) {
    testWidgets(
        'saved local mode does not fetch a remote voice catalog; baseLocal=$baseLocal',
        (tester) async {
      final fixture = ResourceFixture();
      final catalog = _CountingVoiceCatalog();
      final controllers = <RealtimeController>[];
      await tester.pumpWidget(_app(AppLanguageScope(
          locale: const Locale('zh'),
          onChanged: (_) {},
          child: RealtimePage(
            config: resourceConfig(local: baseLocal),
            settingsStore: MemoryRealtimeSettingsStore(
                RealtimeRuntimeSettings.fromConfig(resourceConfig())),
            accountSessionStore: MemoryAccountSessionStore(),
            voicePresetClient: catalog,
            controllerFactory: (config) {
              final controller = fixture.controller(config: config);
              controllers.add(controller);
              return controller;
            },
          ))));
      await tester.pumpAndSettle();
      expect(catalog.calls, 0);
      await tester.pumpWidget(const SizedBox.shrink());
      for (final controller in controllers) {
        controller.dispose();
        await controller.disposeAsync();
      }
      catalog.close();
    });
  }
  testWidgets(
      'original panel distinguishes downloading, listed-not-ready and unknown states',
      (tester) async {
    final fixture = ResourceFixture();
    final controller = fixture.controller();
    await _mountPanel(tester, controller);
    for (final row in [
      ['language_resource_downloading', '系统正在下载或等待下载条件', false],
      ['language_resource_not_ready', '系统列出了该语言资源', true],
      ['resource_state_unknown', '系统返回了未知资源状态', false],
    ]) {
      fixture.asr.reason = row[0] as String;
      await tester.tap(find.byKey(const ValueKey('check-local-resources')));
      await tester.pumpAndSettle();
      expect(find.textContaining(row[1] as String), findsOneWidget);
      expect(find.byKey(const ValueKey('prepare-resource-asr|fr|')),
          row[2] == true ? findsOneWidget : findsNothing);
    }
    expect(fixture.asr.preparations, isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
    await controller.disposeAsync();
  });
  testWidgets(
      'voice section displays concrete identity but never declares offline qualification',
      (tester) async {
    final fixture = ResourceFixture();
    fixture.voice.ready = true;
    final controller = fixture.controller();
    await _mountPanel(tester, controller);
    await tester.tap(find.byKey(const ValueKey('check-local-resources')));
    await tester.pumpAndSettle();
    expect(find.textContaining('设备可用，断网待验'), findsOneWidget);
    expect(find.textContaining('System test voice'), findsOneWidget);
    expect(find.text('com.apple.voice.test.ja'), findsOneWidget);
    expect(find.byKey(const ValueKey('prepare-resource-speech|ja|')),
        findsNothing);
    expect(fixture.voice.speaks, 0);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
    await controller.disposeAsync();
  });
  testWidgets(
      'original five-tab app opens resource section in its original settings without downloading',
      (tester) async {
    final fixture = ResourceFixture();
    final config = resourceConfig();
    final controllers = <RealtimeController>[];
    final voices = _SilentVoiceCatalog();
    await tester.pumpWidget(TranslationApp(
      complianceConsentStore: MemoryComplianceConsentStore.accepted(),
      consentAuditUploader: const NoopConsentAuditUploader(),
      shellPage: MainShellPage(
          config: config,
          realtimePage: RealtimePage(
              config: config,
              settingsStore: MemoryRealtimeSettingsStore(),
              accountSessionStore: MemoryAccountSessionStore(),
              voicePresetClient: voices,
              controllerFactory: (effective) {
                final c = fixture.controller(config: effective);
                controllers.add(c);
                return c;
              })),
    ));
    await tester.pumpAndSettle();
    expect(find.byType(NavigationDestination), findsNWidgets(5));
    await tester.tap(find.byType(PopupMenuButton<RealtimeLanguageMenuAction>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('同传设置'));
    await tester.pumpAndSettle();
    expect(find.byType(RealtimeResourcePreparationPanel), findsOneWidget);
    expect(fixture.asr.checks, isEmpty);
    expect(fixture.asr.preparations, isEmpty);
    final check = find.byKey(const ValueKey('check-local-resources'));
    await tester.ensureVisible(check);
    await tester.pumpAndSettle();
    await tester.tap(check);
    await tester.pumpAndSettle();
    expect(fixture.asr.checks.single.language, 'fr');
    expect(fixture.mt.checks.single.targetLanguage, 'ja');
    for (final id in ['asr|fr|', 'translation|fr|ja']) {
      expect(tester.widget<Text>(find.byKey(ValueKey('resource-$id'))).data,
          endsWith('未安装'));
    }
    expect(fixture.asr.preparations, isEmpty);
    expect(fixture.mt.translations, 0);
    expect(find.text('停止验证'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    for (final controller in controllers) {
      await controller.disposeAsync();
    }
    voices.close();
  });

  testWidgets(
      'prepare requires confirmation, shows progress, cancels and ignores a late result',
      (tester) async {
    final fixture = ResourceFixture();
    final controller = fixture.controller();
    fixture.mt.pending = Completer<void>();
    await _mountPanel(tester, controller);
    await tester.tap(find.byKey(const ValueKey('check-local-resources')));
    await tester.pumpAndSettle();
    final prepare =
        find.byKey(const ValueKey('prepare-resource-translation|fr|ja'));
    await tester.tap(prepare);
    await tester.pumpAndSettle();
    expect(find.textContaining('可能联网下载'), findsOneWidget);
    expect(fixture.mt.preparations, isEmpty);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(fixture.mt.preparations, isEmpty);
    await tester.tap(prepare);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('confirm-resource-download')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(fixture.mt.preparations, hasLength(1));
    expect(find.textContaining('准备中'), findsWidgets);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('cancel-local-resources')));
    await tester.pumpAndSettle();
    expect(find.textContaining('已停止本次准备'), findsOneWidget);
    fixture.mt.pending!.complete();
    await tester.pumpAndSettle();
    expect(find.textContaining('资源已就绪'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
    await controller.disposeAsync();
  });

  testWidgets(
      'ready is separate from qualification and resource section is absent online',
      (tester) async {
    final fixture = ResourceFixture();
    final controller = fixture.controller();
    fixture.asr.ready = fixture.mt.ready = true;
    await _mountPanel(tester, controller);
    await tester.tap(find.byKey(const ValueKey('check-local-resources')));
    await tester.pumpAndSettle();
    expect(find.textContaining('资源已就绪'), findsNWidgets(2));
    expect(find.textContaining('质量、自动语言和系统声音仍需单独核验'), findsOneWidget);
    await tester.pumpWidget(_app(RealtimeSettingsSheet(
        realtimeMode: 'conversation',
        settings:
            RealtimeRuntimeSettings.fromConfig(resourceConfig(local: false)),
        enabled: true,
        modeEnabled: true,
        autoSpeakSupported: true,
        onRealtimeModeChanged: (_) {},
        onSettingsChanged: (_) {},
        resourceSection:
            RealtimeResourcePreparationPanel(controller: controller))));
    await tester.pumpAndSettle();
    expect(find.byType(RealtimeResourcePreparationPanel), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
    await controller.disposeAsync();
  });

  testWidgets(
      'resource panel remains scrollable at narrow width with large text',
      (tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final fixture = ResourceFixture();
    final controller = fixture.controller();
    await tester.pumpWidget(_app(MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(2)),
        child: SingleChildScrollView(
            child: RealtimeResourcePreparationPanel(controller: controller)))));
    await tester.pumpAndSettle();
    final check = find.byKey(const ValueKey('check-local-resources'));
    await tester.ensureVisible(check);
    await tester.tap(check);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
    await controller.disposeAsync();
  });
}

Future<void> _mountPanel(
    WidgetTester tester, RealtimeController controller) async {
  await tester.pumpWidget(_app(SingleChildScrollView(
      child: RealtimeResourcePreparationPanel(controller: controller))));
  await tester.pumpAndSettle();
}

Widget _app(Widget child) => MaterialApp(
    locale: const Locale('zh'),
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: const [
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate
    ],
    home: Scaffold(body: child));

class _SilentVoiceCatalog extends VoicePresetClient {
  _SilentVoiceCatalog() : super(baseUrl: Uri.parse('http://127.0.0.1:1'));
  @override
  Future<VoicePresetCatalog> load() async => const VoicePresetCatalog.empty();
}

class _CountingVoiceCatalog extends _SilentVoiceCatalog {
  int calls = 0;
  @override
  Future<VoicePresetCatalog> load() async {
    calls++;
    return super.load();
  }
}
