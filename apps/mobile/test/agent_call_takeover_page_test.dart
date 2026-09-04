import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/data/ai_calling_agent_api_client.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/presentation/pages/agent_call_takeover_page.dart';

import 'support/ai_calling_agent_test_support.dart';
import 'support/fake_call_link_test_clients.dart';

void main() {
  testWidgets('hangup uses the AI phone cancellation route, not SIP control',
      (tester) async {
    final agentClient = _TakeoverAgentClient();
    final callClient = FakeCallLinkApiClient();
    final roomClient = FakeCallRoomClient();

    await tester.pumpWidget(MaterialApp(
      home: AgentCallTakeoverPage(
        draftId: 'draft_1',
        callId: 'call_1',
        takeoverReadyAt: '2026-08-06T07:00:00.000Z',
        agentClient: agentClient,
        callClient: callClient,
        roomClient: roomClient,
      ),
    ));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.tap(find.text('进入人工通话'));
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('结束本次通话'), findsOneWidget);
    expect(roomClient.airTakeoverUplink, isTrue);
    expect(roomClient.activeMicrophoneEnabled, isTrue);

    await tester.tap(find.text('结束本次通话'));
    await tester.pump(const Duration(milliseconds: 100));

    expect(agentClient.cancelledDraftIds, ['draft_1']);
    expect(callClient.sipHangupCount, 0);
    expect(find.textContaining('等待电话网络确认'), findsOneWidget);
    expect(find.textContaining('已向 Air780 发送挂断请求'), findsOneWidget);
  });

  testWidgets('keeps microphone closed until takeover binding is persisted',
      (tester) async {
    final agentClient = _TakeoverAgentClient(resolveTakeover: false);
    final roomClient = FakeCallRoomClient();
    await tester.pumpWidget(MaterialApp(
      home: AgentCallTakeoverPage(
        draftId: 'draft_1',
        callId: 'call_1',
        takeoverReadyAt: '2026-08-06T07:00:00.000Z',
        agentClient: agentClient,
        callClient: FakeCallLinkApiClient(),
        roomClient: roomClient,
      ),
    ));

    await tester.pump(const Duration(milliseconds: 50));
    await tester.tap(find.text('进入人工通话'));
    await tester.pump(const Duration(milliseconds: 100));

    expect(roomClient.activeMicrophoneEnabled, isFalse);
    expect(find.textContaining('接管绑定尚未确认'), findsOneWidget);
  });

  testWidgets('keeps takeover active when hangup was definitely not dispatched',
      (tester) async {
    final agentClient = _TakeoverAgentClient(hangupStatus: 'failed');
    final roomClient = FakeCallRoomClient();
    await tester.pumpWidget(MaterialApp(
      home: AgentCallTakeoverPage(
        draftId: 'draft_1',
        callId: 'call_1',
        takeoverReadyAt: '2026-08-06T07:00:00.000Z',
        agentClient: agentClient,
        callClient: FakeCallLinkApiClient(),
        roomClient: roomClient,
      ),
    ));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.tap(find.text('进入人工通话'));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.tap(find.text('结束本次通话'));
    await tester.pump(const Duration(milliseconds: 100));

    expect(roomClient.activeMicrophoneEnabled, isTrue);
    expect(find.text('结束本次通话'), findsOneWidget);
    expect(find.textContaining('挂断未下发'), findsOneWidget);
  });
}

class _TakeoverAgentClient extends FakeAiCallingAgentClient {
  _TakeoverAgentClient({
    this.resolveTakeover = true,
    this.hangupStatus = 'accepted',
  });

  final bool resolveTakeover;
  final String hangupStatus;

  @override
  Future<AiCallingAgentDraft> getDraft({required String draftId}) async {
    return agentDraft(
      status: 'takeover_requested',
      callId: 'call_1',
      executionProvider: 'air780_volte',
      carrierState: 'connected',
      liveKitParticipantState: 'joined',
    );
  }

  @override
  Future<AiCallingAgentDraft> acceptTakeover({
    required String draftId,
    required String participantIdentity,
  }) async {
    return agentDraft(
      status: 'takeover_requested',
      callId: 'call_1',
      takeoverReadyAt: '2026-08-06T07:00:00.000Z',
      takeoverResolvedAt: resolveTakeover ? '2026-08-06T07:00:01.000Z' : null,
    );
  }

  @override
  Future<AiCallingAgentDraft> cancelDraft({
    required String draftId,
    String reason = 'user_cancelled',
  }) async {
    cancelledDraftIds.add(draftId);
    lastCancellation = AiCallingAgentCancellation(
      status: hangupStatus,
      code: hangupStatus == 'failed'
          ? 'phone_hangup_unavailable'
          : 'phone_hangup_accepted',
    );
    return agentDraft(status: 'cancelled', callId: 'call_1');
  }
}
