import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_online_recovery_actions.dart';

void main() {
  testWidgets('hides recovery actions when not visible', (tester) async {
    await tester.pumpWidget(_TestApp(
      visible: false,
      onRetryOnline: () {},
      onSwitchToOnDevice: () {},
    ));

    expect(find.text('重试在线'), findsNothing);
    expect(find.text('切回端侧'), findsNothing);
  });

  testWidgets('shows Chinese recovery actions and invokes callbacks',
      (tester) async {
    var retryCount = 0;
    var switchCount = 0;
    await tester.pumpWidget(_TestApp(
      visible: true,
      onRetryOnline: () => retryCount += 1,
      onSwitchToOnDevice: () => switchCount += 1,
    ));

    expect(find.text('重试在线'), findsOneWidget);
    expect(find.text('切回端侧'), findsOneWidget);
    expect(find.text('在线链路异常时可先切回端侧继续同传'), findsOneWidget);

    await tester.tap(find.text('重试在线'));
    await tester.tap(find.text('切回端侧'));

    expect(retryCount, 1);
    expect(switchCount, 1);
  });

  testWidgets('shows English recovery actions', (tester) async {
    await tester.pumpWidget(_TestApp(
      locale: const Locale('en'),
      visible: true,
      onRetryOnline: () {},
      onSwitchToOnDevice: () {},
    ));

    expect(find.text('Retry online'), findsOneWidget);
    expect(find.text('Use on device'), findsOneWidget);
    expect(
      find.text('Retry the server route or keep translating on device.'),
      findsOneWidget,
    );
  });
}

class _TestApp extends StatelessWidget {
  const _TestApp({
    required this.visible,
    required this.onRetryOnline,
    required this.onSwitchToOnDevice,
    this.locale = const Locale('zh'),
  });

  final Locale locale;
  final bool visible;
  final VoidCallback onRetryOnline;
  final VoidCallback onSwitchToOnDevice;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: locale,
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Center(
          child: RealtimeOnlineRecoveryActions(
            visible: visible,
            onRetryOnline: onRetryOnline,
            onSwitchToOnDevice: onSwitchToOnDevice,
          ),
        ),
      ),
    );
  }
}
