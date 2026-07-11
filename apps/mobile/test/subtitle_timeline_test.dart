import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/subtitle_timeline.dart';

void main() {
  testWidgets('auto-scrolls to the latest subtitle segment', (tester) async {
    final segments = List<SubtitleSegment>.generate(12, (index) {
      return SubtitleSegment(
        id: 'seg_$index',
        sourceText: 'source $index',
        translatedText: 'translated $index',
      );
    });

    await tester.pumpWidget(_TestApp(segments: segments.take(4).toList()));
    expect(find.text('translated 11'), findsNothing);

    await tester.pumpWidget(_TestApp(segments: segments));
    await tester.pumpAndSettle();

    expect(find.text('translated 11'), findsOneWidget);
  });

  testWidgets('shows back to latest when user reads older subtitles',
      (tester) async {
    final segments = List<SubtitleSegment>.generate(28, (index) {
      return SubtitleSegment(
        id: 'seg_$index',
        sourceText: 'source $index',
        translatedText: 'translated $index',
      );
    });

    await tester.pumpWidget(_TestApp(segments: segments));
    await tester.pumpAndSettle();

    expect(find.text('translated 27'), findsOneWidget);
    expect(find.text('回到底部'), findsNothing);

    await tester.drag(find.byType(Scrollable), const Offset(0, 220));
    await tester.pumpAndSettle();

    final withNewTail = <SubtitleSegment>[
      ...segments,
      const SubtitleSegment(
        id: 'seg_28',
        sourceText: 'source 28',
        translatedText: 'translated 28',
      ),
    ];
    await tester.pumpWidget(_TestApp(segments: withNewTail));
    await tester.pump();

    expect(find.text('回到底部'), findsOneWidget);

    await tester.tap(find.text('回到底部'));
    await tester.pumpAndSettle();

    expect(find.text('translated 28'), findsOneWidget);
    expect(find.text('回到底部'), findsNothing);
  });

}

class _TestApp extends StatelessWidget {
  const _TestApp({required this.segments});

  final List<SubtitleSegment> segments;

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
      home: Scaffold(
        body: SizedBox(
          height: 280,
          child: SubtitleTimeline(segments: segments),
        ),
      ),
    );
  }
}
