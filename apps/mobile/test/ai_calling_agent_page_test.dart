import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/account/data/account_auth_headers.dart';
import 'package:translation_mobile/src/features/compliance/data/voice_processing_consent_store.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/data/ai_calling_agent_api_client.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/presentation/pages/ai_calling_agent_page.dart';

void main() {
  testWidgets('creates and authorizes low risk agent draft', (tester) async {
    final client = _FakeAiCallingAgentClient();
    await _pumpAgentPage(
      tester,
      client: client,
      voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
    );

    await tester.enterText(find.byType(TextField).at(2), '预约牙医复诊');
    await tester.tap(find.text('外呼接通后先告知对方正在与 AI 通话'));
    await tester.tap(find.text('生成话术草稿'));
    await tester.pumpAndSettle();

    expect(find.text('话术预览'), findsOneWidget);
    expect(find.textContaining('预约牙医复诊'), findsWidgets);
    expect(find.text('话术草稿已生成，请确认授权。'), findsOneWidget);

    await tester.drag(find.byType(ListView), const Offset(0, -260));
    await tester.pumpAndSettle();
    await tester.tap(find.text('确认授权'));
    await tester.pumpAndSettle();

    expect(client.authorizedDraftIds, <String>['draft_1']);
    expect(find.text('状态：已授权'), findsOneWidget);
    expect(find.text('已授权，可开始执行。'), findsOneWidget);

    await tester.tap(find.text('开始执行'));
    await tester.pumpAndSettle();

    expect(client.startedDraftIds, <String>['draft_1']);
    expect(find.text('状态：排队中'), findsOneWidget);
    expect(find.text('Call ID：call_1'), findsOneWidget);
    expect(find.text('已进入执行队列，可刷新查看进度。'), findsOneWidget);

    await tester.tap(find.text('刷新状态'));
    await tester.pumpAndSettle();

    expect(client.refreshedDraftIds, <String>['draft_1']);
    expect(find.text('状态：已完成'), findsOneWidget);
    expect(find.text('结果摘要：已完成预约。'), findsOneWidget);
  });

  testWidgets('requires voice consent before authorizing agent draft',
      (tester) async {
    final client = _FakeAiCallingAgentClient();
    final store = MemoryVoiceProcessingConsentStore();
    await _pumpAgentPage(tester, client: client, voiceConsentStore: store);

    await tester.enterText(find.byType(TextField).at(2), '预约牙医复诊');
    await tester.tap(find.text('外呼接通后先告知对方正在与 AI 通话'));
    await tester.tap(find.text('生成话术草稿'));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView), const Offset(0, -260));
    await tester.pumpAndSettle();

    await tester.tap(find.text('确认授权'));
    await tester.pumpAndSettle();

    expect(find.text('语音敏感信息处理确认'), findsOneWidget);
    expect(client.authorizedDraftIds, isEmpty);

    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();

    expect(client.authorizedDraftIds, isEmpty);

    await tester.tap(find.text('确认授权'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('我同意本次使用云端语音'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('同意并继续'));
    await tester.pumpAndSettle();

    expect(store.record?.version, voiceProcessingConsentVersion);
    expect(client.authorizedDraftIds, <String>['draft_1']);
    expect(find.text('状态：已授权'), findsOneWidget);
  });

  testWidgets('shows login guidance before creating account-owned agent drafts',
      (tester) async {
    await _pumpAgentPage(
      tester,
      client: _FakeAiCallingAgentClient(authRequired: true),
      voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
    );

    await tester.enterText(find.byType(TextField).at(2), '预约牙医复诊');
    await tester.tap(find.text('生成话术草稿'));
    await tester.pumpAndSettle();

    expect(find.text('登录后使用在线服务'), findsOneWidget);
    expect(find.text('AI 代打电话需要登录账号，用于保存授权、任务状态和用量记录。'), findsOneWidget);
    expect(find.text('去登录'), findsOneWidget);
    expect(find.textContaining('需要先登录账号'), findsNothing);
  });

  testWidgets('high risk agent draft requires takeover', (tester) async {
    final client = _FakeAiCallingAgentClient();
    await _pumpAgentPage(
      tester,
      client: client,
      voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
    );

    await tester.enterText(find.byType(TextField).at(2), '联系银行处理转账和身份验证');
    await tester.tap(find.text('生成话术草稿'));
    await tester.pumpAndSettle();

    expect(find.text('状态：需要接管'), findsOneWidget);
    expect(find.text('付款'), findsOneWidget);
    expect(find.text('身份验证'), findsOneWidget);

    await tester.drag(find.byType(ListView), const Offset(0, -260));
    await tester.pumpAndSettle();
    await tester.tap(find.text('人工接管'));
    await tester.pumpAndSettle();

    expect(client.takeoverDraftIds, <String>['draft_1']);
    expect(find.text('状态：已请求接管'), findsOneWidget);
    expect(find.text('已记录人工接管请求。'), findsOneWidget);
  });

  testWidgets('cancels agent draft before authorization', (tester) async {
    final client = _FakeAiCallingAgentClient();
    await _pumpAgentPage(
      tester,
      client: client,
      voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
    );

    await tester.enterText(find.byType(TextField).at(2), '预约牙医复诊');
    await tester.tap(find.text('生成话术草稿'));
    await tester.pumpAndSettle();

    await tester.drag(find.byType(ListView), const Offset(0, -260));
    await tester.pumpAndSettle();
    await tester.tap(find.text('取消任务'));
    await tester.pumpAndSettle();

    expect(client.cancelledDraftIds, <String>['draft_1']);
    expect(find.text('状态：已取消'), findsOneWidget);
    expect(find.text('已取消任务，未发起拨号。'), findsOneWidget);
  });
}

Future<void> _pumpAgentPage(
  WidgetTester tester, {
  required _FakeAiCallingAgentClient client,
  required VoiceProcessingConsentStore voiceConsentStore,
}) async {
  await tester.pumpWidget(MaterialApp(
    locale: const Locale('zh'),
    localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
    ],
    supportedLocales: AppLocalizations.supportedLocales,
    home: AiCallingAgentPage(
      client: client,
      voiceConsentStore: voiceConsentStore,
    ),
  ));
}

class _FakeAiCallingAgentClient extends AiCallingAgentApiClient {
  _FakeAiCallingAgentClient({this.authRequired = false})
      : super(
          baseUrl: Uri.parse('http://localhost'),
          client: MockClient((_) async => http.Response('{}', 500)),
        );

  final bool authRequired;
  final List<String> authorizedDraftIds = <String>[];
  final List<String> startedDraftIds = <String>[];
  final List<String> refreshedDraftIds = <String>[];
  final List<String> takeoverDraftIds = <String>[];
  final List<String> cancelledDraftIds = <String>[];

  @override
  Future<AiCallingAgentDraft> createDraft({
    required String scenario,
    required String objective,
    String language = 'zh',
    String? targetName,
    String? targetPhone,
    String? suggestedScript,
  }) async {
    if (authRequired) throw const AccountAuthRequiredException();
    final highRisk = objective.contains('转账') || objective.contains('身份验证');
    return _draft(
      objective: objective,
      status: highRisk ? 'requires_human_takeover' : 'draft',
      riskLevel: highRisk ? 'requires_human_takeover' : 'low',
      riskReasons: highRisk
          ? const <String>['payment', 'identity_verification']
          : const <String>[],
    );
  }

  @override
  Future<AiCallingAgentDraft> authorizeDraft({
    required String draftId,
    required String consentPromptVersion,
    required bool recipientDisclosureConfirmed,
    required String disclosurePromptVersion,
  }) async {
    authorizedDraftIds.add(draftId);
    return _draft(status: 'authorized');
  }

  @override
  Future<AiCallingAgentDraft> startDraft({
    required String draftId,
    required String consentPromptVersion,
  }) async {
    startedDraftIds.add(draftId);
    return _draft(status: 'queued', callId: 'call_1');
  }

  @override
  Future<AiCallingAgentDraft> getDraft({required String draftId}) async {
    refreshedDraftIds.add(draftId);
    return _draft(
      status: 'completed',
      callId: 'call_1',
      resultSummary: '已完成预约。',
    );
  }

  @override
  Future<AiCallingAgentDraft> requestTakeover({
    required String draftId,
    required String reason,
  }) async {
    takeoverDraftIds.add(draftId);
    return _draft(
      status: 'takeover_requested',
      riskLevel: 'requires_human_takeover',
      riskReasons: const <String>['payment', 'identity_verification'],
    );
  }

  @override
  Future<AiCallingAgentDraft> cancelDraft({
    required String draftId,
    String reason = 'user_cancelled_before_authorization',
  }) async {
    cancelledDraftIds.add(draftId);
    return _draft(status: 'cancelled');
  }
}

AiCallingAgentDraft _draft({
  String objective = '预约牙医复诊',
  String status = 'draft',
  String riskLevel = 'low',
  List<String> riskReasons = const <String>[],
  String? callId,
  String? resultSummary,
}) {
  return AiCallingAgentDraft(
    id: 'draft_1',
    scenario: 'booking',
    status: status,
    objective: objective,
    suggestedScript: '您好，我想咨询：$objective',
    language: 'zh',
    riskLevel: riskLevel,
    riskReasons: riskReasons,
    callId: callId,
    resultSummary: resultSummary,
  );
}
