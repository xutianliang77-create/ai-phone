import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/shell/presentation/pages/settings_home_page.dart';

void main() {
  testWidgets('all me-page actions remain reachable with large text',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final config = _releaseConfig();

    await tester.pumpWidget(MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: const TextScaler.linear(2),
        ),
        child: child!,
      ),
      home: SettingsHomePage(config: config),
    ));
    await tester.pumpAndSettle();

    expect(find.text('同传设置'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('帮助与反馈'),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('帮助与反馈'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('版本 1.2.3（构建 45）'),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('无界AI'), findsOneWidget);
    expect(find.text('版本 1.2.3（构建 45）'), findsOneWidget);
    expect(find.text('国内版 · 中英优先 · PSTN 暂未开放'), findsOneWidget);
    expect(find.textContaining('internal.example'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('refreshes account state after returning from login',
      (WidgetTester tester) async {
    final store = MemoryAccountSessionStore();

    await tester.pumpWidget(MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: SettingsHomePage(
        config: _releaseConfig(),
        accountSessionStore: store,
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('登录无界 AI'), findsOneWidget);
    await tester.tap(find.text('登录无界 AI'));
    await tester.pumpAndSettle();

    await store.save(const AccountSession(
      token: 'token_1',
      expiresAtIso: '2026-08-03T00:00:00.000Z',
    ));
    Navigator.of(tester.element(find.text('账号与登录'))).pop();
    await tester.pumpAndSettle();

    expect(find.text('已登录'), findsOneWidget);
    expect(find.text('登录无界 AI'), findsNothing);
  });
}

AppConfig _releaseConfig() {
  return AppConfig(
    apiBaseUrl: Uri.parse('https://internal.example:3100'),
    useMockAudio: false,
    useDeviceAsr: false,
    deviceAsrProvider: 'coreml_nemotron',
    deviceAsrLanguage: 'auto',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    serverOwnedHistory: true,
    appVersion: '1.2.3',
    buildNumber: '45',
  );
}
