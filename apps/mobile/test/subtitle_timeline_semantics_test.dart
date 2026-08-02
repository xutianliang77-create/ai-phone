import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/subtitle_timeline.dart';

void main() {
  testWidgets('only the latest pending translation interrupts a screen reader',
      (tester) async {
    final semantics = tester.ensureSemantics();
    try {
      final history = List<SubtitleSegment>.generate(12, (index) {
        return SubtitleSegment(
          id: 'history_$index',
          sourceText: 'source $index',
          translatedText: 'translation $index',
          stage: 'translation',
        );
      });
      final segments = <SubtitleSegment>[
        ...history,
        const SubtitleSegment(
          id: 'older_pending',
          sourceText: 'older pending partial',
          translatedText: '',
          stage: 'asr',
        ),
        const SubtitleSegment(
          id: 'latest_pending',
          sourceText: 'latest pending partial',
          translatedText: '',
          stage: 'asr',
        ),
      ];

      await tester.pumpWidget(_TestApp(segments: segments));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      final liveLabels = tester.semantics
          .simulatedAccessibilityTraversal()
          .where((node) => node.flagsCollection.isLiveRegion)
          .map((node) => node.label)
          .where((label) => label.isNotEmpty)
          .toList();
      expect(liveLabels, const <String>['翻译中']);

      final pendingNodes = tester
          .widgetList<Semantics>(find.byType(Semantics))
          .where((widget) => widget.properties.label == '翻译中')
          .toList();
      expect(pendingNodes, hasLength(2));
      expect(
        pendingNodes.where((widget) => widget.properties.liveRegion == true),
        hasLength(1),
      );
      expect(
        pendingNodes
            .singleWhere((widget) => widget.properties.liveRegion == true)
            .excludeSemantics,
        isTrue,
      );

      const pendingKey = ValueKey('subtitle-pending-latest_pending');
      final announcementId = tester.getSemantics(find.byKey(pendingKey)).id;
      await tester.pumpWidget(_TestApp(segments: <SubtitleSegment>[
        ...history,
        segments[segments.length - 2],
        const SubtitleSegment(
          id: 'latest_pending',
          sourceText: 'latest pending partial extended',
          translatedText: '',
          stage: 'asr',
        ),
      ]));
      await tester.pump(const Duration(milliseconds: 20));

      final updatedAnnouncement = tester.getSemantics(find.byKey(pendingKey));
      expect(updatedAnnouncement.id, announcementId);
      expect(updatedAnnouncement.label, '翻译中');
      expect(updatedAnnouncement.flagsCollection.isLiveRegion, isTrue);
    } finally {
      semantics.dispose();
    }
  });

  testWidgets('exposes completed subtitle content once to screen readers',
      (tester) async {
    final semantics = tester.ensureSemantics();
    try {
      await tester.pumpWidget(const _TestApp(segments: <SubtitleSegment>[
        SubtitleSegment(
          id: 'read_once',
          sourceText: 'read once source',
          translatedText: 'read once translation',
          stage: 'translation',
        ),
      ]));
      await tester.pump();

      final labels = tester.semantics
          .simulatedAccessibilityTraversal()
          .map((node) => node.label)
          .where((label) => label.contains('read once source'))
          .toList();
      expect(
        labels,
        const <String>[
          '当前句，read once source，read once translation',
        ],
      );
    } finally {
      semantics.dispose();
    }
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
      home: MediaQuery(
        data: const MediaQueryData(size: Size(400, 640)),
        child: Scaffold(
          body: SizedBox.fromSize(
            size: const Size(400, 640),
            child: SubtitleTimeline(segments: segments),
          ),
        ),
      ),
    );
  }
}
