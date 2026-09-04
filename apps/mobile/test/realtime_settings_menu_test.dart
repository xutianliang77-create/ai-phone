import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';

import 'widget_test.dart';

void main() {
  testWidgets('opens realtime controls from language menu', (tester) async {
    await pumpAcceptedApp(tester);

    expect(find.byTooltip('自动朗读译文'), findsOneWidget);
    expect(find.text('朗读'), findsNothing);
    expect(find.text('在线模型链路'), findsNothing);
    expect(find.text('服务器模型路由'), findsNothing);

    await tester.tap(find.byTooltip('语言'));
    await tester.pumpAndSettle();
    expect(find.text('同传设置'), findsOneWidget);

    await tester.tap(find.text('同传设置'));
    await tester.pumpAndSettle();

    expect(find.text('端侧'), findsOneWidget);
    expect(find.text('在线'), findsOneWidget);
    expect(find.text('源语言'), findsOneWidget);
    expect(find.text('自动识别'), findsOneWidget);
    expect(find.text('目标语言'), findsOneWidget);
    expect(find.text('自动反向'), findsOneWidget);
    expect(find.text('朗读声音'), findsOneWidget);
    expect(find.text('关闭'), findsOneWidget);
    expect(find.text('自然声音'), findsOneWidget);
    expect(find.text('我的声音'), findsOneWidget);
    expect(find.text('对话'), findsOneWidget);
    expect(find.text('聆听'), findsOneWidget);
  });

  testWidgets('toggles auto speak from realtime home shortcut', (tester) async {
    await pumpAcceptedApp(tester);

    var shortcut = tester.widget<IconButton>(
      find.widgetWithIcon(IconButton, Icons.voice_over_off_outlined),
    );
    expect(shortcut.onPressed, isNotNull);
    expect(
      (shortcut.icon as Icon).icon,
      Icons.voice_over_off_outlined,
    );

    await tester.tap(find.byTooltip('自动朗读译文'));
    await tester.pumpAndSettle();

    shortcut = tester.widget<IconButton>(
      find.widgetWithIcon(IconButton, Icons.record_voice_over),
    );
    expect((shortcut.icon as Icon).icon, Icons.record_voice_over);
  });

  testWidgets('localizes realtime settings menu in English', (tester) async {
    await pumpAcceptedApp(tester, locale: const Locale('en'));

    await tester.tap(find.byTooltip('Language'));
    await tester.pumpAndSettle();
    expect(find.text('Realtime settings'), findsOneWidget);

    await tester.tap(find.text('Realtime settings'));
    await tester.pumpAndSettle();

    expect(find.text('Talk'), findsOneWidget);
    expect(find.text('Listening'), findsOneWidget);
  });

  testWidgets('defaults Listening silent without losing the Talk voice setting',
      (tester) async {
    await pumpAcceptedApp(tester);
    await tester.tap(find.byTooltip('自动朗读译文'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('语言'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('同传设置'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('聆听'));
    await tester.pumpAndSettle();
    var selector = tester.widget<SegmentedButton<RealtimeVoiceOutputMode>>(
      find.byType(SegmentedButton<RealtimeVoiceOutputMode>),
    );
    expect(selector.onSelectionChanged, isNotNull);
    expect(selector.selected,
        <RealtimeVoiceOutputMode>{RealtimeVoiceOutputMode.off});

    await tester.tap(find.text('对话'));
    await tester.pumpAndSettle();
    selector = tester.widget<SegmentedButton<RealtimeVoiceOutputMode>>(
      find.byType(SegmentedButton<RealtimeVoiceOutputMode>),
    );
    expect(selector.onSelectionChanged, isNotNull);
    expect(selector.selected,
        <RealtimeVoiceOutputMode>{RealtimeVoiceOutputMode.natural});
  });
}
