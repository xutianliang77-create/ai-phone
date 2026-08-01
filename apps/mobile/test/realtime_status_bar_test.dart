import 'package:flutter/material.dart';
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
}
