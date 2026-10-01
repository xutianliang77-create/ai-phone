import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_settings_sheet.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_settings_sheet_launcher.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';

const _closeKey = ValueKey('close-realtime-settings');
const _initial = RealtimeRuntimeSettings(
  processingMode: RealtimeProcessingMode.onDevice,
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  voiceOutputMode: RealtimeVoiceOutputMode.natural,
  domainLexiconPack: 'medical',
);

void main() {
  for (final layout in [
    (const Size(393, 852), 1.0, const Locale('zh')),
    (const Size(320, 568), 1.8, const Locale('zh')),
    (const Size(852, 393), 1.3, const Locale('en')),
  ]) {
    testWidgets('close remains reachable with long settings $layout',
        (tester) async {
      tester.view.physicalSize = layout.$1;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final fixture = _Fixture();
      await fixture.mount(tester, scale: layout.$2, locale: layout.$3);
      await tester.tap(find.text('Open settings'));
      await tester.pumpAndSettle();
      final close = find.byKey(_closeKey);
      expect(close.hitTestable(), findsOneWidget);
      final before = tester.getRect(close);
      expect(before.top, greaterThanOrEqualTo(44));
      final list = find.descendant(
          of: find.byType(RealtimeSettingsSheet),
          matching: find.byType(ListView));
      await tester.drag(list, const Offset(0, -1400));
      await tester.pumpAndSettle();
      expect(close.hitTestable(), findsOneWidget);
      expect(tester.getRect(close), before);
      expect(tester.takeException(), isNull);
      await tester.tap(close);
      await tester.pumpAndSettle();
      expect(find.byType(RealtimeSettingsSheet), findsNothing);
      expect(find.text('Host realtime page'), findsOneWidget);
      expect(fixture.settings.toStorageJson(), _initial.toStorageJson());
      expect(fixture.endRequests, 0);
      await fixture.dispose(tester);
    });
  }

  testWidgets('closing a locked sheet does not end the active conversation',
      (tester) async {
    final fixture = _Fixture(enabled: false);
    await fixture.mount(tester);
    await tester.tap(find.text('Open settings'));
    await tester.pumpAndSettle();
    expect(find.byKey(_closeKey).hitTestable(), findsOneWidget);
    await tester.tap(find.byKey(_closeKey));
    await tester.pumpAndSettle();
    expect(find.text('Host realtime page'), findsOneWidget);
    expect(fixture.endRequests, 0);
    expect(fixture.changes, 0);
    await fixture.dispose(tester);
  });

  testWidgets('a repeated close request cannot pop the underlying page',
      (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    await tester.tap(find.text('Open settings'));
    await tester.pumpAndSettle();
    final close = tester.widget<CloseButton>(find.byKey(_closeKey)).onPressed!;
    close();
    close();
    await tester.pumpAndSettle();
    expect(find.text('Host realtime page'), findsOneWidget);
    expect(find.text('Root route'), findsNothing);
    expect(tester.takeException(), isNull);
    await fixture.dispose(tester);
  });

  testWidgets(
      'close after a mode change pops only this sheet and retains values',
      (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    await tester.tap(find.text('Open settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('在线'));
    await tester.pumpAndSettle();
    final expected =
        _initial.copyWith(processingMode: RealtimeProcessingMode.online);
    expect(fixture.settings.toStorageJson(), expected.toStorageJson());
    await tester.tap(find.byKey(_closeKey));
    await tester.pumpAndSettle();
    expect(find.text('Host realtime page'), findsOneWidget);
    expect(find.text('Root route'), findsNothing);
    await tester.tap(find.text('Open settings'));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<RealtimeSettingsSheet>(find.byType(RealtimeSettingsSheet))
            .settings
            .toStorageJson(),
        expected.toStorageJson());
    await tester.tap(find.byKey(_closeKey));
    await tester.pumpAndSettle();
    expect(fixture.endRequests, 0);
    expect(fixture.changes, 1);
    expect(tester.takeException(), isNull);
    await fixture.dispose(tester);
  });
}

class _Fixture {
  _Fixture({this.enabled = true});
  final bool enabled;
  final changesNotifier = ValueNotifier(0);
  RealtimeRuntimeSettings settings = _initial;
  int endRequests = 0, changes = 0;

  Future<void> mount(WidgetTester tester,
      {double scale = 1, Locale locale = const Locale('zh')}) async {
    await tester.pumpWidget(MaterialApp(
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(scale),
          padding: const EdgeInsets.only(top: 44, bottom: 34),
          viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
        ),
        child: child!,
      ),
      home: Builder(
          builder: (context) => Scaffold(
                  body: TextButton(
                child: const Text('Root route'),
                onPressed: () =>
                    Navigator.of(context).push(MaterialPageRoute<void>(
                  builder: (context) => Scaffold(
                    appBar: AppBar(title: const Text('Host realtime page')),
                    body: TextButton(
                      child: const Text('Open settings'),
                      onPressed: () => showRealtimeSettingsSheet(
                        context: context,
                        listenable: changesNotifier,
                        realtimeMode: () => 'conversation',
                        settings: () => settings,
                        enabled: () => enabled,
                        modeEnabled: () => enabled,
                        autoSpeakSupported: () => true,
                        onRealtimeModeChanged: (_) {},
                        onSettingsChanged: (next) {
                          settings = next;
                          changes++;
                        },
                        onEndRequested: () => endRequests++,
                        resourceSectionBuilder: () => const SizedBox(
                            height: 1800, child: Text('Long resource section')),
                      ),
                    ),
                  ),
                )),
              ))),
    ));
    await tester.tap(find.text('Root route'));
    await tester.pumpAndSettle();
  }

  Future<void> dispose(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    changesNotifier.dispose();
  }
}
