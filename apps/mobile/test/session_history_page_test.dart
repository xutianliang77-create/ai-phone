import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/history/presentation/pages/session_history_page.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';

void main() {
  testWidgets('opens meeting notes from records list',
      (WidgetTester tester) async {
    final repository = _FakeSessionHistoryRepository();
    await tester.pumpWidget(_TestApp(
      child: SessionHistoryPage(repository: repository),
    ));
    await tester.pumpAndSettle();

    expect(find.text('历史记录'), findsOneWidget);
    expect(find.text('会议纪要'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, '会议纪要'));
    await tester.pumpAndSettle();

    expect(repository.generatedReview, isTrue);
    expect(find.text('会话详情'), findsOneWidget);
    expect(find.textContaining('服务端摘要', findRichText: true), findsOneWidget);
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

  @override
  Future<List<SessionListItem>> listSessions({String query = ''}) async {
    return <SessionListItem>[
      SessionListItem(
        sessionId: 's1',
        mode: 'meeting',
        status: 'ended',
        consumedSeconds: 60,
        createdAt: DateTime.utc(2026, 7, 9, 12),
        endedAt: DateTime.utc(2026, 7, 9, 12, 1),
        segmentCount: 2,
      ),
    ];
  }

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

  SessionDetail _detail(
    String sessionId, {
    Map<String, Object?>? reviewJson,
  }) {
    return SessionDetail(
      sessionId: sessionId,
      mode: 'meeting',
      status: 'ended',
      consumedSeconds: 60,
      createdAt: DateTime.utc(2026, 7, 9, 12),
      endedAt: DateTime.utc(2026, 7, 9, 12, 1),
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
          sourceText: '会后发送纪要',
          translatedText: 'Send meeting notes after the meeting',
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
