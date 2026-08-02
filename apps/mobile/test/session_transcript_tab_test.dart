import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/presentation/widgets/session_transcript_tab.dart';

void main() {
  testWidgets('keeps raw recognition collapsed until requested',
      (WidgetTester tester) async {
    await tester.pumpWidget(_TestApp(
      child: SessionTranscriptTab(segments: _segments()),
    ));

    expect(find.text('会议纪要已经发送'), findsOneWidget);
    expect(find.text('The meeting notes were sent'), findsOneWidget);
    expect(find.text('会议既要已经发送'), findsNothing);
    expect(find.text('智能优化'), findsOneWidget);
    expect(find.text('查看原始识别'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('transcript-raw-toggle-0')));
    await tester.pumpAndSettle();

    expect(find.text('会议既要已经发送'), findsOneWidget);
    expect(find.text('收起原始识别'), findsOneWidget);
  });

  testWidgets('filters a long transcript and clears search at large text',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(_TestApp(
      textScale: 2,
      child: SessionTranscriptTab(segments: _segments()),
    ));

    expect(find.text('共 120 段'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('transcript-search-toggle')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('transcript-search-field')),
      '预算',
    );
    await tester.pumpAndSettle();

    expect(find.text('找到 1 / 120 段'), findsOneWidget);
    expect(find.text('预算是二十万元'), findsOneWidget);
    expect(find.text('会议纪要已经发送'), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.enterText(
      find.byKey(const ValueKey('transcript-search-field')),
      '既要',
    );
    await tester.pumpAndSettle();
    expect(find.text('找到 1 / 120 段'), findsOneWidget);
    expect(find.text('会议纪要已经发送'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('transcript-raw-toggle-0')));
    await tester.pumpAndSettle();
    expect(find.text('会议既要已经发送'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('transcript-search-field')),
      '200,000',
    );
    await tester.pumpAndSettle();
    expect(find.text('预算是二十万元'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('transcript-search-field')),
      '不存在的内容',
    );
    await tester.pumpAndSettle();
    expect(find.text('未找到匹配内容'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('transcript-search-clear')));
    await tester.pumpAndSettle();
    expect(find.text('共 120 段'), findsOneWidget);
    expect(find.text('会议纪要已经发送'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

List<SessionSegment> _segments() {
  return <SessionSegment>[
    const SessionSegment(
      id: '0',
      sourceText: '会议纪要已经发送',
      rawText: '会议既要已经发送',
      optimizedText: '会议纪要已经发送',
      translatedText: 'The meeting notes were sent',
    ),
    const SessionSegment(
      id: '1',
      sourceText: '预算是二十万元',
      translatedText: 'The budget is 200,000 yuan',
    ),
    for (var index = 2; index < 120; index += 1)
      SessionSegment(
        id: '$index',
        sourceText: '第 $index 段会议内容',
        translatedText: 'Meeting segment $index',
      ),
  ];
}

class _TestApp extends StatelessWidget {
  const _TestApp({required this.child, this.textScale = 1});

  final Widget child;
  final double textScale;

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
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScale),
        ),
        child: child!,
      ),
      home: Scaffold(body: child),
    );
  }
}
