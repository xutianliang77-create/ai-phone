import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_client.dart';
import 'package:translation_mobile/src/features/call_link/presentation/widgets/call_link_result_panel.dart';

void main() {
  testWidgets('fits the call link result at 320dp and 200 percent text',
      (tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

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
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: CallLinkResultPanel(
            link: CallLink(
              callId: 'call_1',
              sessionId: 'call_1',
              roomName: 'call_call_1',
              roomProvider: 'livekit',
              joinUrl: 'https://call.example.cn/join/call_1',
              hostUrl: 'https://call.example.cn/host/call_1',
              status: 'created',
              expiresAt: DateTime.utc(2026, 7, 16),
              activeGuestCount: 1,
            ),
            roomSnapshot: const CallRoomSnapshot.disconnected(
              message: '等待对方加入后开始双语通话',
            ),
            roomBusy: false,
            endResult: null,
            onEnterRoom: () {},
            onEndRoom: () {},
            onShare: (_) {},
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('无界AI 通话服务已准备'), findsOneWidget);
    expect(find.textContaining('livekit'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
