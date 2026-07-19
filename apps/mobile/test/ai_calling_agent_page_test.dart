import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/compliance/data/voice_processing_consent_store.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/data/ai_calling_agent_api_client.dart';

import 'support/ai_calling_agent_test_support.dart';

void main() {
  testWidgets('creates and authorizes low risk agent draft', (tester) async {
    final client = FakeAiCallingAgentClient();
    await pumpAgentPage(
      tester,
      client: client,
      voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
    );
    await tester.enterText(find.byType(TextField).at(2), '预约牙医复诊');
    await tester.tap(find.text('接通后先告知对方正在与 AI 通话'));
    await tester.ensureVisible(find.text('生成话术草稿'));
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
    final client = FakeAiCallingAgentClient();
    final store = MemoryVoiceProcessingConsentStore();
    await pumpAgentPage(tester, client: client, voiceConsentStore: store);
    await tester.enterText(find.byType(TextField).at(2), '预约牙医复诊');
    await tester.tap(find.text('接通后先告知对方正在与 AI 通话'));
    await tester.ensureVisible(find.text('生成话术草稿'));
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

  testWidgets('rejects malformed target phone before creating a draft',
      (tester) async {
    await pumpAgentPage(
      tester,
      client: FakeAiCallingAgentClient(),
      voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
    );

    await tester.enterText(find.byType(TextField).at(1), '1380000000');
    await tester.enterText(find.byType(TextField).at(2), '预约会议室');
    await tester.ensureVisible(find.text('生成话术草稿'));
    await tester.tap(find.text('生成话术草稿'));
    await tester.pumpAndSettle();

    expect(find.text('请输入有效电话号码'), findsOneWidget);
    expect(find.text('话术预览'), findsNothing);
  });

  testWidgets('shows login guidance before creating account-owned agent drafts',
      (tester) async {
    await pumpAgentPage(
      tester,
      client: FakeAiCallingAgentClient(authRequired: true),
      voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
    );

    await tester.enterText(find.byType(TextField).at(2), '预约牙医复诊');
    await tester.ensureVisible(find.text('生成话术草稿'));
    await tester.tap(find.text('生成话术草稿'));
    await tester.pumpAndSettle();

    expect(find.text('登录后使用在线服务'), findsOneWidget);
    expect(find.text('AI 代打电话需要登录账号，用于保存授权、任务状态和用量记录。'), findsOneWidget);
    expect(find.text('去登录'), findsOneWidget);
    expect(find.textContaining('需要先登录账号'), findsNothing);
  });

  testWidgets('high risk agent draft requires takeover', (tester) async {
    final client = FakeAiCallingAgentClient();
    await pumpAgentPage(
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
    final client = FakeAiCallingAgentClient();
    await pumpAgentPage(
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

  testWidgets('loads previous tasks and cancels an authorized task',
      (tester) async {
    final client = FakeAiCallingAgentClient(
      initialDrafts: <AiCallingAgentDraft>[
        agentDraft(objective: '历史预约任务', status: 'authorized'),
      ],
    );
    await pumpAgentPage(
      tester,
      client: client,
      voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('任务管理（1）'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('任务管理（1）'), findsOneWidget);
    await tester.ensureVisible(find.text('历史预约任务').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('历史预约任务').first);
    await tester.pumpAndSettle();
    expect(find.text('状态：已授权'), findsOneWidget);

    await tester.drag(find.byType(ListView), const Offset(0, -500));
    await tester.pumpAndSettle();
    await tester.tap(find.text('取消任务'));
    await tester.pumpAndSettle();

    expect(client.cancelledDraftIds, <String>['draft_1']);
    expect(find.text('状态：已取消'), findsOneWidget);
  });

  testWidgets('keeps task management reachable on a narrow large-text screen',
      (tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final client = FakeAiCallingAgentClient(
      initialDrafts: <AiCallingAgentDraft>[
        agentDraft(objective: '确认明天下午的牙医复诊预约', status: 'authorized'),
      ],
    );

    await pumpAgentPage(
      tester,
      client: client,
      voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
      textScale: 2,
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('任务管理（1）'),
      300,
      scrollable: find.byType(Scrollable).first,
    );

    expect(find.text('任务管理（1）'), findsOneWidget);
    expect(find.text('确认明天下午的牙医复诊预约'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows retryable task history failure without hiding the form',
      (tester) async {
    await pumpAgentPage(
      tester,
      client: FakeAiCallingAgentClient(
        listError: const AiCallingAgentApiException('offline'),
      ),
      voiceConsentStore: MemoryVoiceProcessingConsentStore.accepted(),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('任务加载失败，请重试。'),
      300,
      scrollable: find.byType(Scrollable).first,
    );

    expect(find.text('任务加载失败，请重试。'), findsOneWidget);
    expect(find.text('生成话术草稿'), findsOneWidget);
    expect(find.byTooltip('刷新任务'), findsOneWidget);
  });
}
