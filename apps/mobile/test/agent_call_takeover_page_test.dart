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

    await tester.tap(find.text('结束本次通话'));
    await tester.pump(const Duration(milliseconds: 100));

    expect(agentClient.cancelledDraftIds, ['draft_1']);
    expect(callClient.sipHangupCount, 0);
    expect(find.text('通话已结束'), findsOneWidget);
    expect(find.textContaining('已向 Air780 发送挂断请求'), findsOneWidget);
  });
}

class _TakeoverAgentClient extends FakeAiCallingAgentClient {
  final List<String> cancelledDraftIds = <String>[];

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
    );
  }

  @override
  Future<AiCallingAgentDraft> cancelDraft({
    required String draftId,
    String reason = 'user_cancelled',
  }) async {
    cancelledDraftIds.add(draftId);
    lastCancellation = const AiCallingAgentCancellation(
      status: 'accepted',
      code: 'phone_hangup_accepted',
    );
    return agentDraft(status: 'cancelled', callId: 'call_1');
  }
}
