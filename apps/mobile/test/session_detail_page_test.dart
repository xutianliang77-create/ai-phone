import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/history/presentation/pages/session_detail_page.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';

void main() {
  testWidgets('shows summary highlights transcript and terms tabs',
      (WidgetTester tester) async {
    final repository = _FakeSessionHistoryRepository();
    await tester.pumpWidget(_TestApp(
      child: SessionDetailPage(
        sessionId: 's1',
        repository: repository,
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.widgetWithText(Tab, '字幕'), findsOneWidget);
    expect(find.widgetWithText(Tab, '纪要'), findsOneWidget);
    expect(find.widgetWithText(Tab, '待办'), findsOneWidget);
    expect(
      find.textContaining('Meeting at three this afternoon',
          findRichText: true),
      findsOneWidget,
    );

    await tester.tap(find.widgetWithText(Tab, '纪要'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('生成会议纪要'), findsWidgets);
    expect(find.text('重点'), findsOneWidget);
    expect(find.textContaining('今天下午三点开会'), findsWidgets);
    expect(find.text('字幕'), findsWidgets);
    expect(find.text('subtitles'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, '确认').last);
    await tester.pumpAndSettle();
    expect(repository.confirmedTerms.single.sourceText, '字幕');
    expect(find.text('撤销'), findsOneWidget);

    await tester.tap(find.text('撤销'));
    await tester.pumpAndSettle();
    expect(repository.revokedTermIds.single, 'term_1');
  });

  testWidgets('generates server review and refreshes detail',
      (WidgetTester tester) async {
    final repository = _FakeSessionHistoryRepository();
    await tester.pumpWidget(_TestApp(
      child: SessionDetailPage(
        sessionId: 's1',
        repository: repository,
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(Tab, '纪要'));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.auto_awesome_outlined).first);
    await tester.pumpAndSettle();

    expect(repository.generatedReview, isTrue);
    await tester.tap(find.widgetWithText(Tab, '纪要'));
    await tester.pumpAndSettle();
    expect(find.textContaining('服务端摘要', findRichText: true), findsOneWidget);
    expect(find.byTooltip('重新生成'), findsWidgets);
  });

  testWidgets('persists action item updates when reopening the detail',
      (WidgetTester tester) async {
    final repository = _FakeSessionHistoryRepository(withActionItems: true);
    await tester.pumpWidget(_TestApp(
      child: SessionDetailPage(sessionId: 's1', repository: repository),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(Tab, '待办'));
    await tester.pumpAndSettle();
    expect(_actionItem(tester).value, isFalse);

    await tester.tap(find.byKey(const ValueKey('action-item-0')));
    await tester.pumpAndSettle();
    expect(repository.actionUpdates, <({int index, bool completed})>[
      (index: 0, completed: true),
    ]);
    expect(_actionItem(tester).value, isTrue);

    await tester.pumpWidget(_TestApp(
      child: SessionDetailPage(
        key: UniqueKey(),
        sessionId: 's1',
        repository: repository,
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(Tab, '待办'));
    await tester.pumpAndSettle();
    expect(_actionItem(tester).value, isTrue);
  });

  testWidgets('keeps action item unchanged when persistence fails',
      (WidgetTester tester) async {
    final repository = _FakeSessionHistoryRepository(
      withActionItems: true,
      actionItemError: StateError('test persistence failure'),
    );
    await tester.pumpWidget(_TestApp(
      child: SessionDetailPage(sessionId: 's1', repository: repository),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(Tab, '待办'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('action-item-0')));
    await tester.pumpAndSettle();

    expect(_actionItem(tester).value, isFalse);
    expect(find.textContaining('test persistence failure'), findsOneWidget);
  });

  testWidgets('keeps all detail tabs usable at narrow width and large text',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final repository = _FakeSessionHistoryRepository(withActionItems: true);

    await tester.pumpWidget(_TestApp(
      textScale: 2,
      child: SessionDetailPage(sessionId: 's1', repository: repository),
    ));
    await tester.pumpAndSettle();

    for (final label in <String>['字幕', '纪要', '待办']) {
      await tester.tap(find.widgetWithText(Tab, label));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    }
    expect(find.byKey(const ValueKey('action-item-0')), findsOneWidget);
  });
}

CheckboxListTile _actionItem(WidgetTester tester) {
  return tester.widget<CheckboxListTile>(
    find.byKey(const ValueKey('action-item-0')),
  );
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
      home: child,
    );
  }
}

class _FakeSessionHistoryRepository extends SessionHistoryRepository {
  _FakeSessionHistoryRepository({
    this.withActionItems = false,
    this.actionItemError,
  }) : super(shareService: _FakeFileShareService());

  final bool withActionItems;
  final Object? actionItemError;
  bool generatedReview = false;
  bool actionItemCompleted = false;
  final List<({int index, bool completed})> actionUpdates =
      <({int index, bool completed})>[];
  final List<TermbaseTerm> confirmedTerms = <TermbaseTerm>[];
  final List<String> revokedTermIds = <String>[];

  @override
  Future<SessionDetail> getSession(String sessionId) async {
    return _detail(
      sessionId,
      reviewJson: withActionItems ? _actionReview() : null,
    );
  }

  @override
  Future<SessionDetail> generateReview(String sessionId) async {
    generatedReview = true;
    return _detail(
      sessionId,
      reviewJson: const <String, Object?>{
        'summary': '服务端摘要',
        'highlights': <Map<String, Object?>>[],
        'terms': <Map<String, Object?>>[],
      },
    );
  }

  @override
  Future<TermbaseTerm> confirmTerm({
    required String sessionId,
    required String sourceText,
    required String translatedText,
  }) async {
    final term = TermbaseTerm(
      id: 'term_1',
      sourceText: sourceText,
      translatedText: translatedText,
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      status: 'active',
    );
    confirmedTerms.add(term);
    return term;
  }

  @override
  Future<TermbaseTerm> revokeTerm(String termId) async {
    revokedTermIds.add(termId);
    return const TermbaseTerm(
      id: 'term_1',
      sourceText: '字幕',
      translatedText: 'subtitles',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      status: 'revoked',
    );
  }

  @override
  Future<SessionDetail> updateActionItem(
    String sessionId,
    int actionIndex,
    bool completed,
  ) async {
    actionUpdates.add((index: actionIndex, completed: completed));
    if (actionItemError != null) throw actionItemError!;
    actionItemCompleted = completed;
    return _detail(sessionId, reviewJson: _actionReview());
  }

  Map<String, Object?> _actionReview() {
    return <String, Object?>{
      'summary': '服务端摘要',
      'highlights': <Map<String, Object?>>[],
      'terms': <Map<String, Object?>>[],
      'actionItems': <Map<String, Object?>>[
        <String, Object?>{
          'text': '发送会议纪要',
          'completed': actionItemCompleted,
          'owner': '小林',
          'dueDate': '明天',
        },
      ],
    };
  }

  SessionDetail _detail(
    String sessionId, {
    Map<String, Object?>? reviewJson,
  }) {
    return SessionDetail(
      sessionId: sessionId,
      mode: 'meeting',
      status: 'ended',
      consumedSeconds: 60,
      createdAt: DateTime.utc(2026, 7, 2),
      segmentCount: 2,
      reviewJson: reviewJson,
      segments: const <SessionSegment>[
        SessionSegment(
          id: '1',
          sourceText: '今天下午三点开会',
          translatedText: 'Meeting at three this afternoon',
        ),
        SessionSegment(
          id: '2',
          sourceText: '字幕',
          translatedText: 'subtitles',
        ),
      ],
    );
  }
}

class _FakeFileShareService implements FileShareService {
  @override
  Future<String> saveExportFile(List<int> bytes, String filename) async {
    return filename;
  }

  @override
  Future<void> shareFile(String path, {String? mimeType}) async {}
}
