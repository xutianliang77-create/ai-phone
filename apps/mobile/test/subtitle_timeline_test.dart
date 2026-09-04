import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/subtitle_timeline.dart';
import 'package:translation_mobile/src/shared/domain/speaker_attribution.dart';
import 'package:translation_mobile/src/shared/domain/turn_language_profile.dart';

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

  testWidgets('coalesces rapid tail updates without losing auto-follow',
      (tester) async {
    final history = List<SubtitleSegment>.generate(24, (index) {
      return SubtitleSegment(
        id: 'history_$index',
        sourceText: 'source $index',
        translatedText: 'translated $index',
        stage: 'translation',
      );
    });
    await tester.pumpWidget(_TestApp(segments: history));
    await tester.pumpAndSettle();

    await tester.pumpWidget(_TestApp(segments: <SubtitleSegment>[
      ...history,
      const SubtitleSegment(
        id: 'burst',
        sourceText: 'rapid source',
        translatedText: '',
        stage: 'asr',
      ),
    ]));
    await tester.pump(const Duration(milliseconds: 20));
    await tester.pumpWidget(_TestApp(segments: <SubtitleSegment>[
      ...history,
      const SubtitleSegment(
        id: 'burst',
        sourceText: 'rapid source',
        translatedText: 'rapid translation',
        stage: 'translation',
      ),
    ]));
    await tester.pump(const Duration(milliseconds: 20));
    await tester.pumpWidget(_TestApp(segments: <SubtitleSegment>[
      ...history,
      const SubtitleSegment(
        id: 'burst',
        sourceText: 'rapid source final',
        translatedText: 'rapid translation final',
        stage: 'final',
      ),
    ]));
    await tester.pumpAndSettle();

    expect(find.text('rapid translation final'), findsOneWidget);
    expect(find.text('回到底部'), findsNothing);
    expect(
      tester.getBottomLeft(find.text('rapid translation final')).dy,
      lessThan(280),
    );
  });

  testWidgets('marks the current sentence and shows translation pending',
      (tester) async {
    const pending = <SubtitleSegment>[
      SubtitleSegment(
        id: 'complete',
        sourceText: 'previous source',
        translatedText: 'previous translation',
        stage: 'translation',
      ),
      SubtitleSegment(
        id: 'current',
        sourceText: 'current source',
        translatedText: '',
        stage: 'asr',
      ),
    ];

    await tester.pumpWidget(const _TestApp(segments: pending));
    await tester.pump();

    expect(find.text('当前句'), findsOneWidget);
    expect(find.text('翻译中'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    final completed = <SubtitleSegment>[
      pending.first,
      const SubtitleSegment(
        id: 'current',
        sourceText: 'current source',
        translatedText: 'current translation',
        stage: 'translation',
      ),
    ];
    await tester.pumpWidget(_TestApp(segments: completed));
    await tester.pumpAndSettle();

    expect(find.text('当前句'), findsOneWidget);
    expect(find.text('翻译中'), findsNothing);
    expect(find.text('current translation'), findsOneWidget);
  });

  testWidgets('fits long subtitles at 320dp and 200 percent text',
      (tester) async {
    final segments = List<SubtitleSegment>.generate(8, (index) {
      return SubtitleSegment(
        id: 'long_$index',
        sourceText: '这是一段用于验证小屏幕大字体布局的中文长句，编号 $index。',
        translatedText:
            'This is a long translated sentence for narrow layout $index.',
        stage: 'translation',
      );
    });

    await tester.pumpWidget(_TestApp(
      segments: segments,
      size: const Size(320, 568),
      textScale: 2,
    ));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.textContaining('narrow layout 7'), findsOneWidget);
  });

  testWidgets('fits a landscape subtitle workspace', (tester) async {
    const segments = <SubtitleSegment>[
      SubtitleSegment(
        id: 'landscape',
        sourceText: '横屏字幕不会被固定高度裁切',
        translatedText: 'Landscape subtitles remain visible.',
        stage: 'translation',
      ),
    ];

    await tester.pumpWidget(const _TestApp(
      segments: segments,
      size: Size(844, 240),
    ));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Landscape subtitles remain visible.'), findsOneWidget);
  });

  testWidgets('shows an anonymous speaker without inventing an identity',
      (tester) async {
    const segments = <SubtitleSegment>[
      SubtitleSegment(
        id: 'speaker_segment',
        sourceText: '你好',
        translatedText: 'Hello',
        speaker: SpeakerAttribution(
          speakerId: 'speaker_2',
          role: 'speaker',
          source: 'diarization',
          confidence: 0.9,
        ),
      ),
    ];

    await tester.pumpWidget(const _TestApp(segments: segments));
    expect(find.text('说话人 2'), findsOneWidget);
    expect(find.text('我'), findsNothing);
  });

  testWidgets('shows unknown, overlap, and mixed-language metadata',
      (tester) async {
    const segments = <SubtitleSegment>[
      SubtitleSegment(
        id: 'overlap_segment',
        sourceText: '你好 and welcome',
        translatedText: 'Hello，欢迎。',
        speaker: SpeakerAttribution(
          speakerId: 'unknown',
          role: 'unknown',
          source: 'unknown',
        ),
        timing: SegmentTiming(
          startMs: 1000,
          endMs: 1800,
          source: 'client',
          overlap: true,
          activeSpeakerIds: <String>['speaker_1', 'speaker_2'],
        ),
        languageProfile: TurnLanguageProfile(
          dominantLanguage: 'zh',
          detectedLanguages: <String>['zh', 'en'],
          mixedLanguage: true,
        ),
      ),
    ];

    await tester.pumpWidget(const _TestApp(segments: segments));

    expect(find.text('说话人未知'), findsOneWidget);
    expect(find.text('多人同时说话'), findsOneWidget);
    expect(find.text('中英混合'), findsOneWidget);
  });
}

class _TestApp extends StatelessWidget {
  const _TestApp({
    required this.segments,
    this.size = const Size(400, 280),
    this.textScale = 1,
  });

  final List<SubtitleSegment> segments;
  final Size size;
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
      home: MediaQuery(
        data: MediaQueryData(
          size: size,
          textScaler: TextScaler.linear(textScale),
        ),
        child: Scaffold(
          body: SizedBox.fromSize(
            size: size,
            child: SubtitleTimeline(segments: segments),
          ),
        ),
      ),
    );
  }
}
