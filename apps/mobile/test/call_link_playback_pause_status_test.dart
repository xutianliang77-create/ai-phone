import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/call_link/presentation/pages/call_link_page.dart';
import 'package:translation_mobile/src/features/compliance/data/voice_processing_consent_store.dart';

import 'support/fake_call_link_test_clients.dart';

void main() {
  testWidgets(
      'shows when translated playback temporarily pauses the microphone',
      (tester) async {
    await tester.pumpWidget(_TestApp(
      child: CallLinkPage(
        client: FakeCallLinkApiClient(),
        roomClient: FakeCallRoomClient(
          microphoneEnabled: false,
          microphonePausedForPlayback: true,
        ),
        voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
      ),
    ));

    await tester.tap(find.text('生成链接'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('进入房间'));
    await tester.pumpAndSettle();

    expect(find.textContaining('译音播放中，麦克风暂挂'), findsOneWidget);
    expect(find.textContaining('麦克风未发布'), findsNothing);
  });
}

class _TestApp extends StatelessWidget {
  const _TestApp({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: child,
    );
  }
}
