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

    expect(find.text('摘要'), findsOneWidget);
    expect(find.text('会议纪要'), findsOneWidget);
    expect(find.text('生成会议纪要'), findsOneWidget);
    expect(find.text('重点'), findsOneWidget);
    expect(find.text('全文'), findsOneWidget);
    expect(find.text('术语'), findsOneWidget);
    expect(
      find.textContaining('Meeting at three this afternoon',
          findRichText: true),
      findsOneWidget,
    );

    await tester.tap(find.text('重点'));
    await tester.pumpAndSettle();
    expect(find.text('时间'), findsOneWidget);

    await tester.tap(find.text('术语'));
    await tester.pumpAndSettle();
    expect(find.text('字幕'), findsOneWidget);
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

    await tester.tap(find.widgetWithText(FilledButton, '生成会议纪要'));
    await tester.pumpAndSettle();

    expect(repository.generatedReview, isTrue);
    expect(find.textContaining('服务端摘要', findRichText: true), findsOneWidget);
    expect(find.text('重新生成'), findsOneWidget);
  });
}

class _TestApp extends StatelessWidget {
  const _TestApp({required this.child});

  final Widget child;

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
      home: child,
    );
  }
}

class _FakeSessionHistoryRepository extends SessionHistoryRepository {
  _FakeSessionHistoryRepository()
      : super(shareService: _FakeFileShareService());

  bool generatedReview = false;
  final List<TermbaseTerm> confirmedTerms = <TermbaseTerm>[];
  final List<String> revokedTermIds = <String>[];

  @override
  Future<SessionDetail> getSession(String sessionId) async {
    return _detail(sessionId);
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
