import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_status_bar.dart';

void main() {
  testWidgets('shows whether translation speech is off, enabled, or playing',
      (WidgetTester tester) async {
    Future<void> pumpStatus({
      required bool autoSpeakTranslation,
      bool speechOutputActive = false,
    }) {
      return tester.pumpWidget(MaterialApp(
        locale: const Locale('zh'),
        localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: RealtimeStatusBar(
            status: RealtimeStatus.active,
            autoSpeakTranslation: autoSpeakTranslation,
            speechOutputActive: speechOutputActive,
          ),
        ),
      ));
    }

    await pumpStatus(autoSpeakTranslation: false);
    expect(find.text('朗读：关闭'), findsOneWidget);

    await pumpStatus(autoSpeakTranslation: true);
    expect(find.text('朗读：已开启'), findsOneWidget);

    await pumpStatus(
      autoSpeakTranslation: true,
      speechOutputActive: true,
    );
    expect(find.text('正在播音'), findsOneWidget);
  });

  testWidgets(
      'announces connection failures and balance warnings at large text',
      (WidgetTester tester) async {
    final semantics = tester.ensureSemantics();
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(320, 568);
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(const MaterialApp(
      locale: Locale('zh'),
      localizationsDelegates: <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: MediaQuery(
        data: MediaQueryData(textScaler: TextScaler.linear(2)),
        child: Scaffold(
          body: RealtimeStatusBar(
            status: RealtimeStatus.failed,
            routeLabel: '自动识别 → 自动反向',
            message: 'Realtime connection lost',
            remainingSeconds: 8,
            lowBalance: true,
          ),
        ),
      ),
    ));

    const announcement = '实时连接已断开\n在线同传剩余 8 秒，请及时充值或切回端侧';
    final status = find.bySemanticsLabel(announcement);
    expect(status, findsOneWidget);
    expect(
      tester.getSemantics(status),
      matchesSemantics(
        label: announcement,
        textDirection: TextDirection.ltr,
        isLiveRegion: true,
      ),
    );
    expect(tester.takeException(), isNull);
    expect(tester.getSize(find.byType(RealtimeStatusBar)).width, 320);
    semantics.dispose();
  });

  testWidgets('keeps replayed and missed audio visible in an iPhone app bar',
      (WidgetTester tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        appBar: AppBar(
          toolbarHeight: 76,
          titleSpacing: 0,
          title: const RealtimeStatusBar(
            status: RealtimeStatus.active,
            routeLabel: '自动识别 → 自动反向',
            message:
                'Realtime connection restored; replayed 2400 ms; missed 12000 ms',
          ),
          actions: const <Widget>[SizedBox(width: 48)],
        ),
      ),
    ));

    final status = find.text('已恢复·补2.4秒·漏传12秒');
    expect(status, findsOneWidget);
    final paragraph = tester.renderObject<RenderParagraph>(status);
    expect(
      paragraph.getMaxIntrinsicWidth(double.infinity),
      lessThanOrEqualTo(paragraph.size.width + 0.5),
    );
    expect(tester.takeException(), isNull);
  });
}
