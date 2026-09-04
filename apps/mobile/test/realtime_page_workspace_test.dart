import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app.dart';
import 'package:translation_mobile/src/features/compliance/data/compliance_consent_store.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_language_menu.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_mode_selector.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_settings_panel.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_status_bar.dart';

void main() {
  testWidgets('Listening starts muted and permits speech after language changes',
      (tester) async {
    await _pumpApp(tester);
    tester
        .widget<RealtimeLanguageMenu>(find.byType(RealtimeLanguageMenu))
        .onOpenRealtimeSettings();
    await tester.pumpAndSettle();
    tester
        .widget<RealtimeModeSelector>(find.byType(RealtimeModeSelector))
        .onChanged('meeting');
    await tester.pumpAndSettle();
    var panel = tester.widget<RealtimeSettingsPanel>(
        find.byType(RealtimeSettingsPanel));
    expect(panel.autoSpeakSupported, isTrue);
    expect(panel.settings.autoSpeakTranslation, isFalse);
    panel.onChanged(panel.settings.copyWith(targetLanguage: 'auto_reverse'));
    await tester.pumpAndSettle();
    final selector = tester.widget<SegmentedButton<RealtimeVoiceOutputMode>>(
        find.byType(SegmentedButton<RealtimeVoiceOutputMode>));
    expect(selector.onSelectionChanged, isNotNull);
    selector.onSelectionChanged!({RealtimeVoiceOutputMode.natural});
    await tester.pumpAndSettle();
    panel = tester.widget<RealtimeSettingsPanel>(
        find.byType(RealtimeSettingsPanel));
    expect(panel.settings.autoSpeakTranslation, isTrue);
    panel.onChanged(panel.settings.copyWith(targetLanguage: 'pt'));
    await tester.pumpAndSettle();
    panel = tester.widget<RealtimeSettingsPanel>(
        find.byType(RealtimeSettingsPanel));
    expect(panel.settings.targetLanguage, 'pt');
    expect(panel.settings.autoSpeakTranslation, isTrue);
    final bar = tester.widget<RealtimeStatusBar>(find.byType(RealtimeStatusBar));
    expect(bar.autoSpeakEnabled, isTrue);
    expect(bar.autoSpeakTranslation, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('subtitle workspace grows with available page height',
      (tester) async {
    _configureView(tester, const Size(390, 700));
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await _pumpApp(tester);
    final workspace = find.byKey(const ValueKey('realtime-subtitle-workspace'));
    final shortHeight = tester.getSize(workspace).height;

    tester.view.physicalSize = const Size(390, 850);
    await tester.pump();
    final tallHeight = tester.getSize(workspace).height;

    expect(tallHeight, greaterThan(shortHeight + 100));
  });

  testWidgets('realtime page fits a 320dp phone width', (tester) async {
    _configureView(tester, const Size(320, 568));
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await _pumpApp(tester);

    expect(tester.takeException(), isNull);
    expect(find.byKey(const ValueKey('realtime-subtitle-workspace')),
        findsOneWidget);
  });

  testWidgets('realtime page fits 320dp at 200 percent text', (tester) async {
    _configureView(tester, const Size(320, 568));
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
      tester.platformDispatcher.clearTextScaleFactorTestValue();
    });

    await _pumpApp(tester);

    expect(tester.takeException(), isNull);
    expect(find.byKey(const ValueKey('realtime-subtitle-workspace')),
        findsOneWidget);
    expect(find.bySemanticsLabel('开始'), findsOneWidget);
  });

  testWidgets('realtime page fits landscape without fixed subtitle height',
      (tester) async {
    _configureView(tester, const Size(844, 390));
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await _pumpApp(tester);

    expect(tester.takeException(), isNull);
    expect(find.byKey(const ValueKey('realtime-subtitle-workspace')),
        findsOneWidget);
  });
}

void _configureView(WidgetTester tester, Size size) {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
}

Future<void> _pumpApp(WidgetTester tester) async {
  await tester.pumpWidget(TranslationApp(
    complianceConsentStore: MemoryComplianceConsentStore.accepted(),
  ));
  await tester.pump();
}
