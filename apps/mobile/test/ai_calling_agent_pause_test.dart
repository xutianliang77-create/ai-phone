import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/presentation/widgets/ai_calling_agent_draft_panel.dart';

import 'support/ai_calling_agent_test_support.dart';

void main() {
  testWidgets('pauses and resumes AI only on a connected active call',
      (tester) async {
    var pauseCount = 0;
    var resumeCount = 0;

    Widget panel(String controlState, String carrierState) => MaterialApp(
          home: Scaffold(
            body: AiCallingAgentDraftPanel(
              draft: agentDraft(
                status: 'in_progress',
                callId: 'call_1',
                executionProvider: 'air780_volte',
                carrierState: carrierState,
                agentControlState: controlState,
              ),
              busy: false,
              onAuthorize: () {},
              onStart: () {},
              onRefresh: () {},
              onPause: () => pauseCount += 1,
              onResume: () => resumeCount += 1,
              onTakeover: () {},
              onCancel: () {},
            ),
          ),
        );

    await tester.pumpWidget(panel('running', 'connected'));
    expect(find.text('AI 发言：运行中'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, '暂停 AI'));
    expect(pauseCount, 1);
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, '恢复 AI'),
          )
          .onPressed,
      isNull,
    );

    await tester.pumpWidget(panel('paused', 'connected'));
    expect(find.text('AI 发言：已暂停'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, '恢复 AI'));
    expect(resumeCount, 1);

    await tester.pumpWidget(panel('running', 'ringing'));
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, '暂停 AI'),
          )
          .onPressed,
      isNull,
    );
  });
}
