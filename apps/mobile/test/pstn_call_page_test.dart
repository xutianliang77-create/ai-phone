import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/app/region_edition_config.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_client.dart';
import 'package:translation_mobile/src/features/compliance/data/voice_processing_consent_store.dart';
import 'package:translation_mobile/src/features/pstn_call/data/pstn_call_readiness_client.dart';
import 'package:translation_mobile/src/features/pstn_call/presentation/pages/pstn_call_page.dart';
import 'package:translation_mobile/src/features/shell/presentation/pages/call_home_page.dart';

import 'support/fake_call_link_test_clients.dart';

void main() {
  testWidgets('opens direct phone call preparation from call home',
      (tester) async {
    await tester.pumpWidget(_testApp(
      CallHomePage(config: _config(const RegionEditionConfig.domestic())),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('拨打手机号'));
    await tester.pumpAndSettle();

    expect(find.text('直接拨号翻译'), findsOneWidget);
    expect(find.text('P2 灰度功能'), findsOneWidget);
    expect(find.text('对方号码'), findsOneWidget);
    expect(find.text('费用预估'), findsOneWidget);
  });

  testWidgets('shows gated form and normalizes a domestic mobile number',
      (tester) async {
    var fetched = false;
    await _pumpPage(
      tester,
      config: _config(const RegionEditionConfig.domestic()),
      fetcher: (_) async {
        fetched = true;
        throw StateError('should not fetch while policy is disabled');
      },
    );

    expect(find.text('P2 灰度功能'), findsOneWidget);
    expect(find.text('对方号码'), findsOneWidget);
    expect(find.text('我的语言'), findsOneWidget);
    expect(find.text('对方语言'), findsOneWidget);
    expect(fetched, isFalse);

    await tester.enterText(
      find.byKey(const Key('pstn-phone-field')),
      '138 0013 8000',
    );
    await tester.scrollUntilVisible(
      find.byType(CheckboxListTile),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byType(CheckboxListTile));
    await tester.scrollUntilVisible(
      find.text('检查拨号信息'),
      180,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('检查拨号信息'));
    await tester.pumpAndSettle();

    expect(find.text('拨号信息已确认'), findsOneWidget);
    expect(find.textContaining('+8613800138000'), findsOneWidget);
    expect(find.text('当前不发起真实外呼'), findsOneWidget);
  });

  testWidgets('checks live readiness for an enabled PSTN build',
      (tester) async {
    await _pumpPage(
      tester,
      config: _config(const RegionEditionConfig.international()),
      fetcher: (_) async => const PstnCallReadiness(
        status: 'ready',
        policy: 'pstn_enabled',
        enabled: true,
        provider: 'livekit_sip',
        issues: <String>[],
      ),
    );

    expect(find.text('PSTN 链路已就绪'), findsOneWidget);
    expect(find.textContaining('确认信息后可开始拨打'), findsOneWidget);
  });

  testWidgets('connects the host room before starting one SIP outbound call',
      (tester) async {
    final apiClient = FakeCallLinkApiClient();
    final roomClient = FakeCallRoomClient();
    await _pumpPage(
      tester,
      config: _config(const RegionEditionConfig.international()),
      apiClient: apiClient,
      roomClient: roomClient,
      voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
      fetcher: (_) async => const PstnCallReadiness(
        status: 'ready',
        policy: 'pstn_enabled',
        enabled: true,
        provider: 'livekit_sip',
        issues: <String>[],
      ),
    );

    await tester.enterText(
      find.byKey(const Key('pstn-phone-field')),
      '+8613800138000',
    );
    await tester.scrollUntilVisible(
      find.byType(CheckboxListTile),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byType(CheckboxListTile));
    await tester.scrollUntilVisible(
      find.text('检查拨号信息'),
      180,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('检查拨号信息'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('开始拨打'),
      180,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('开始拨打'));
    await tester.pumpAndSettle();

    expect(apiClient.createCount, 1);
    expect(apiClient.tokenCreateCount, 1);
    expect(apiClient.connectionConfirmCount, 1);
    expect(apiClient.sipOutboundCount, 1);
    expect(roomClient.connectedToken?.participantRole, 'host');
    expect(roomClient.translationMediaOnly, isTrue);
    expect(find.text('电话已接通'), findsOneWidget);
  });

  testWidgets('rejects invalid number and missing disclosure', (tester) async {
    await _pumpPage(
      tester,
      config: _config(const RegionEditionConfig.domestic()),
    );

    await tester.enterText(find.byKey(const Key('pstn-phone-field')), '123');
    await tester.scrollUntilVisible(
      find.text('检查拨号信息'),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('检查拨号信息'));
    await tester.pump();
    expect(find.textContaining('请输入有效的手机号'), findsOneWidget);

    await tester.enterText(
      find.byKey(const Key('pstn-phone-field')),
      '13800138000',
    );
    await tester.tap(find.text('检查拨号信息'));
    await tester.pump();
    expect(find.text('请先确认通话告知规则'), findsOneWidget);
  });

  test('parses PSTN readiness from API health', () {
    final readiness = PstnCallReadiness.fromHealthJson(<String, Object?>{
      'pstnReadiness': <String, Object?>{
        'status': 'not_ready',
        'policy': 'domestic_pstn_bridge',
        'enabled': true,
        'provider': 'domestic_bridge',
        'issues': <Object?>['pstn missing PSTN_API_KEY'],
      },
    });

    expect(readiness.isReady, isFalse);
    expect(readiness.provider, 'domestic_bridge');
    expect(readiness.issues, <String>['pstn missing PSTN_API_KEY']);
  });
}

AppConfig _config(RegionEditionConfig region) => AppConfig(
      apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
      useMockAudio: false,
      useDeviceAsr: true,
      deviceAsrProvider: 'coreml_nemotron',
      deviceAsrLanguage: 'auto',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 2240,
      serverOwnedHistory: true,
      region: region,
    );

Future<void> _pumpPage(
  WidgetTester tester, {
  required AppConfig config,
  PstnCallReadinessFetcher fetcher = _unusedFetcher,
  CallLinkApiClient? apiClient,
  CallRoomClient? roomClient,
  VoiceProcessingConsentStore? voiceConsentStore,
}) async {
  await tester.pumpWidget(_testApp(
    PstnCallPage(
      config: config,
      readinessFetcher: fetcher,
      apiClient: apiClient,
      roomClient: roomClient,
      voiceConsentStore: voiceConsentStore,
    ),
  ));
  await tester.pumpAndSettle();
}

Widget _testApp(Widget home) {
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

Future<PstnCallReadiness> _unusedFetcher(Uri _) {
  throw StateError('readiness fetch not expected');
}
