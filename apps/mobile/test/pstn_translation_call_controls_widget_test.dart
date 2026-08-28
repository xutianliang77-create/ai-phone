import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/pstn_call/presentation/widgets/pstn_translation_call_controls.dart';

void main() {
  testWidgets('exposes independent microphone, translated uplink, and text controls',
      (tester) async {
    var microphoneToggles = 0;
    var uplinkToggles = 0;
    var typedMessages = 0;
    var issueReports = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: PstnTranslationCallControls(
          busy: false,
          connected: true,
          microphoneMuted: false,
          uplinkPaused: false,
          chinese: true,
          onToggleMicrophone: () => microphoneToggles += 1,
          onToggleUplink: () => uplinkToggles += 1,
          onTypeToSpeak: () => typedMessages += 1,
          onReportIssue: () => issueReports += 1,
        ),
      ),
    ));

    await tester.tap(find.byKey(const Key('pstn-microphone-toggle')));
    await tester.tap(find.byKey(const Key('pstn-uplink-toggle')));
    await tester.tap(find.byKey(const Key('pstn-type-to-speak')));
    await tester.tap(find.byKey(const Key('pstn-report-call-issue')));

    expect(microphoneToggles, 1);
    expect(uplinkToggles, 1);
    expect(typedMessages, 1);
    expect(issueReports, 1);
  });

  testWidgets('disables typed speech while translated uplink is paused',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: PstnTranslationCallControls(
          busy: false,
          connected: true,
          microphoneMuted: true,
          uplinkPaused: true,
          chinese: false,
          onToggleMicrophone: () {},
          onToggleUplink: () {},
          onTypeToSpeak: () {},
          onReportIssue: () {},
        ),
      ),
    ));

    final button = tester.widget<FilledButton>(
      find.byKey(const Key('pstn-type-to-speak')),
    );
    expect(button.onPressed, isNull);
    expect(find.text('Resume translation'), findsOneWidget);
  });
}
