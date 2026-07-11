import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/compliance/data/voice_processing_consent_store.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_client.dart';
import 'package:translation_mobile/src/shared/domain/speaker_attribution.dart';
import 'package:translation_mobile/src/features/call_link/presentation/pages/call_link_page.dart';
import 'package:translation_mobile/src/features/call_link/presentation/pages/join_call_link_page.dart';

import 'support/fake_call_link_test_clients.dart';

void main() {
  testWidgets('creates and shares a call link', (WidgetTester tester) async {
    var sharedText = '';
    final roomClient = FakeCallRoomClient();
    await tester.pumpWidget(_TestApp(
      child: CallLinkPage(
        client: FakeCallLinkApiClient(),
        roomClient: roomClient,
        voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
        shareText: (text) async => sharedText = text,
      ),
    ));

    await tester.tap(find.text('生成链接'));
    await tester.pumpAndSettle();

    expect(find.text('https://call.example.cn/join/call_1'), findsOneWidget);
    expect(find.text('房间：call_call_1'), findsOneWidget);
    expect(find.text('主持人入会凭证已准备'), findsOneWidget);
    expect(find.textContaining('未入房'), findsOneWidget);
    expect(find.text('secret-room-token'), findsNothing);

    await tester.tap(find.text('分享链接'));
    await tester.pumpAndSettle();

    expect(sharedText, 'https://call.example.cn/join/call_1');
  });

  testWidgets('requires voice consent before creating a call link',
      (WidgetTester tester) async {
    final apiClient = FakeCallLinkApiClient();
    final store = MemoryVoiceProcessingConsentStore();
    await tester.pumpWidget(_TestApp(
      child: CallLinkPage(
        client: apiClient,
        roomClient: FakeCallRoomClient(),
        voiceConsentStore: store,
      ),
    ));

    await tester.tap(find.text('生成链接'));
    await tester.pumpAndSettle();

    expect(find.text('语音敏感信息处理确认'), findsOneWidget);
    expect(apiClient.createCount, 0);

    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();

    expect(apiClient.createCount, 0);
    expect(find.text('https://call.example.cn/join/call_1'), findsNothing);

    await tester.tap(find.text('生成链接'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('我同意本次使用云端语音'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('同意并继续'));
    await tester.pumpAndSettle();

    expect(store.record?.version, voiceProcessingConsentVersion);
    expect(apiClient.createCount, 1);
    expect(find.text('https://call.example.cn/join/call_1'), findsOneWidget);
  });

  testWidgets('shows login guidance before creating account-owned call links',
      (WidgetTester tester) async {
    await tester.pumpWidget(_TestApp(
      child: CallLinkPage(
        client: FakeCallLinkApiClient(authRequired: true),
        roomClient: FakeCallRoomClient(),
        voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
      ),
    ));

    await tester.tap(find.text('生成链接'));
    await tester.pumpAndSettle();

    expect(find.text('登录后使用在线服务'), findsOneWidget);
    expect(find.text('发起翻译电话需要登录账号，用于保存通话记录和结算用量。'), findsOneWidget);
    expect(find.text('去登录'), findsOneWidget);
    expect(find.textContaining('需要先登录账号'), findsNothing);
  });

  testWidgets('joins, ends, and saves the LiveKit host room',
      (WidgetTester tester) async {
    final apiClient = FakeCallLinkApiClient();
    final roomClient = FakeCallRoomClient();
    await tester.pumpWidget(_TestApp(
      child: CallLinkPage(
        client: apiClient,
        roomClient: roomClient,
        voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
      ),
    ));

    await tester.tap(find.text('生成链接'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('进入房间'));
    await tester.pumpAndSettle();

    expect(roomClient.connectedToken?.token, 'secret-room-token');
    expect(find.textContaining('已入房，麦克风已发布'), findsOneWidget);
    expect(find.text('对方人数：1'), findsOneWidget);
    expect(find.text('secret-room-token'), findsNothing);

    await tester.tap(find.text('结束并保存'));
    await tester.pumpAndSettle();

    expect(apiClient.endedCallIds, <String>['call_1']);
    expect(find.textContaining('未入房'), findsOneWidget);
    expect(find.text('通话记录已保存：8 秒'), findsOneWidget);
    expect(find.text('进入房间'), findsNothing);
  });

  testWidgets('shows LiveKit room data messages', (WidgetTester tester) async {
    final roomClient = FakeCallRoomClient(
      message: '你好，这是一次通话房间翻译测试。',
    );
    await tester.pumpWidget(_TestApp(
      child: CallLinkPage(
        client: FakeCallLinkApiClient(),
        roomClient: roomClient,
        voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
      ),
    ));

    await tester.tap(find.text('生成链接'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('进入房间'));
    await tester.pumpAndSettle();

    expect(find.text('你好，这是一次通话房间翻译测试。'), findsOneWidget);
  });

  testWidgets('shows LiveKit room captions', (WidgetTester tester) async {
    final roomClient = FakeCallRoomClient(
      captions: const <CallRoomCaption>[
        CallRoomCaption(
          segmentId: 'segment-1',
          speaker: SpeakerAttribution(
            speakerId: 'guest',
            role: 'guest',
            source: 'participant_track',
          ),
          sourceLanguage: 'en',
          targetLanguage: 'zh',
          timestampMs: 1,
          sourceText: 'hello, this is a call room translation test',
          translatedText: '你好，这是一次通话房间翻译测试。',
          ttsReady: true,
          ttsProvider: 'qwen-tts',
        ),
      ],
    );
    await tester.pumpWidget(_TestApp(
      child: CallLinkPage(
        client: FakeCallLinkApiClient(),
        roomClient: roomClient,
        voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
      ),
    ));

    await tester.tap(find.text('生成链接'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('进入房间'));
    await tester.pumpAndSettle();

    expect(find.text('通话字幕'), findsOneWidget);
    expect(find.text('对方'), findsOneWidget);
    expect(
      find.text('hello, this is a call room translation test'),
      findsOneWidget,
    );
    expect(find.text('你好，这是一次通话房间翻译测试。'), findsOneWidget);
    expect(find.text('翻译语音已准备：qwen-tts'), findsOneWidget);
  });

  testWidgets('auto-scrolls call room captions to the latest entry',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final captions = List<CallRoomCaption>.generate(18, (index) {
      return CallRoomCaption(
        segmentId: 'segment-$index',
        speaker: const SpeakerAttribution(
          speakerId: 'guest',
          role: 'guest',
          source: 'participant_track',
        ),
        sourceLanguage: 'zh',
        targetLanguage: 'en',
        timestampMs: index,
        sourceText: 'source $index',
        translatedText: 'translation $index',
      );
    });
    final roomClient = FakeCallRoomClient(captions: captions);
    await tester.pumpWidget(_TestApp(
      child: CallLinkPage(
        client: FakeCallLinkApiClient(),
        roomClient: roomClient,
        voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
      ),
    ));

    await tester.tap(find.text('生成链接'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('进入房间'));
    await tester.pumpAndSettle();

    final latest = find.text('translation 17');
    expect(latest, findsOneWidget);
    expect(tester.getBottomLeft(latest).dy, lessThan(600));
  });

  testWidgets('keeps the link when host room token is unavailable',
      (WidgetTester tester) async {
    await tester.pumpWidget(_TestApp(
      child: CallLinkPage(
        client: FakeCallLinkApiClient(tokenFails: true),
        roomClient: FakeCallRoomClient(),
        voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
      ),
    ));

    await tester.tap(find.text('生成链接'));
    await tester.pumpAndSettle();

    expect(find.text('https://call.example.cn/join/call_1'), findsOneWidget);
    expect(find.text('主持人入会凭证未准备'), findsOneWidget);
    expect(find.text('进入房间'), findsNothing);
    expect(find.text('准备通话房间失败，请检查 LiveKit 配置'), findsOneWidget);
  });

  testWidgets('joins a pasted call link as guest', (WidgetTester tester) async {
    final apiClient = FakeCallLinkApiClient();
    final roomClient = FakeCallRoomClient();
    await tester.pumpWidget(_TestApp(
      child: JoinCallLinkPage(
        client: apiClient,
        roomClient: roomClient,
        voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
      ),
    ));

    await tester.enterText(
      find.byType(TextField),
      'https://call.example.cn/join/call_1',
    );
    await tester.tap(find.text('加入房间'));
    await tester.pumpAndSettle();

    expect(apiClient.fetchedCallIds, <String>['call_1']);
    expect(roomClient.connectedToken?.participantRole, 'guest');
    expect(roomClient.connectedToken?.token, 'secret-room-token');
    expect(find.text('访客入会凭证已准备'), findsOneWidget);
    expect(find.textContaining('已入房，麦克风已发布'), findsOneWidget);
    expect(find.text('secret-room-token'), findsNothing);

    await tester.tap(find.text('退出房间'));
    await tester.pumpAndSettle();

    expect(find.textContaining('未入房'), findsOneWidget);
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
