import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/app/product_capability_profile.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/shell/presentation/pages/call_home_page.dart';
import 'package:translation_mobile/src/features/shell/presentation/pages/settings_home_page.dart';

void main() {
  testWidgets('private beta call surface keeps core communication only',
      (WidgetTester tester) async {
    await tester.pumpWidget(_app(CallHomePage(
      config: _config(),
      capabilityProfile: ProductCapabilityProfile.coreTranslation,
    )));
    await tester.pumpAndSettle();

    expect(find.text('发起翻译电话'), findsOneWidget);
    expect(find.text('加入通话链接'), findsOneWidget);
    expect(find.text('输入并朗读'), findsOneWidget);
    expect(find.text('拨打手机号'), findsNothing);
    expect(find.text('AI 代打电话'), findsNothing);
  });

  testWidgets('private beta me surface hides billing and voice identity',
      (WidgetTester tester) async {
    await tester.pumpWidget(_app(SettingsHomePage(
      config: _config(),
      accountSessionStore: MemoryAccountSessionStore(),
      capabilityProfile: ProductCapabilityProfile.coreTranslation,
    )));
    await tester.pumpAndSettle();

    expect(find.text('同传设置'), findsOneWidget);
    expect(find.text('朗读声音'), findsOneWidget);
    expect(find.text('我的声音'), findsOneWidget);
    expect(find.text('隐私与安全'), findsOneWidget);
    expect(find.text('声音身份'), findsNothing);
    expect(find.text('订阅与用量'), findsNothing);
  });
}

Widget _app(Widget home) {
  return MaterialApp(
    locale: const Locale('zh'),
    localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
    ],
    supportedLocales: AppLocalizations.supportedLocales,
    home: home,
  );
}

AppConfig _config() {
  return AppConfig(
    apiBaseUrl: Uri.parse('https://api.example.cn'),
    useMockAudio: false,
    useDeviceAsr: false,
    deviceAsrProvider: 'coreml_nemotron',
    deviceAsrLanguage: 'auto',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    serverOwnedHistory: true,
  );
}
