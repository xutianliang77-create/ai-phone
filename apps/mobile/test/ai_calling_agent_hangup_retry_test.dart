import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/presentation/widgets/ai_calling_agent_draft_panel.dart';

import 'support/ai_calling_agent_test_support.dart';

void main() {
  testWidgets('offers hangup replay only while a cancelled call may be active',
      (tester) async {
    var cancelCount = 0;
    Widget panel(String carrierState) => MaterialApp(
          home: Scaffold(
            body: AiCallingAgentDraftPanel(
              draft: agentDraft(
                status: 'cancelled',
                callId: 'call_1',
                executionProvider: 'air780_volte',
                carrierState: carrierState,
              ),
              busy: false,
              onAuthorize: () {},
              onStart: () {},
              onRefresh: () {},
              onTakeover: () {},
              onCancel: () => cancelCount += 1,
            ),
          ),
        );

    await tester.pumpWidget(panel('connected'));
    final retry = find.widgetWithText(OutlinedButton, '重试挂断');
    expect(retry, findsOneWidget);
    await tester.tap(retry);
    expect(cancelCount, 1);

    await tester.pumpWidget(panel('disconnected'));
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, '重试挂断'),
          )
          .onPressed,
      isNull,
    );
  });
}
