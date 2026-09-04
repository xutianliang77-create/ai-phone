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
    expect(find.text('07月09日'), findsOneWidget);
    await tester.tap(find.byTooltip('更多操作'));
    await tester.pumpAndSettle();
    expect(find.text('生成会议纪要'), findsOneWidget);

    await tester.tap(find.text('生成会议纪要'));
    await tester.pumpAndSettle();

    expect(repository.generatedReview, isTrue);
    expect(find.text('会话详情'), findsOneWidget);
    await tester.tap(find.widgetWithText(Tab, '纪要'));
    await tester.pumpAndSettle();
    expect(find.textContaining('服务端摘要', findRichText: true), findsOneWidget);
  });

  testWidgets('filters all record kinds at narrow width and large text',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final repository = _FakeSessionHistoryRepository();

    await tester.pumpWidget(_TestApp(
      textScale: 2,
      child: SessionHistoryPage(repository: repository),
    ));
    await tester.pumpAndSettle();
    expect(find.text('同传记录'), findsOneWidget);

    await tester.tap(find.text('通话'));
    await tester.pumpAndSettle();
    expect(find.text('通话记录'), findsOneWidget);

    await tester.tap(find.text('扫描'));
    await tester.pumpAndSettle();
    expect(find.text('扫描记录'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows a localized offline state and retries',
      (WidgetTester tester) async {
    final repository = _FakeSessionHistoryRepository(
      listError: Exception('ClientException: failed host lookup'),
      listFailuresBeforeRecovery: 1,
    );

    await tester.pumpWidget(_TestApp(
      child: SessionHistoryPage(repository: repository),
    ));
    await tester.pumpAndSettle();

    expect(find.text('网络连接失败，请检查 API 服务是否可用'), findsOneWidget);
    expect(find.text('重试'), findsOneWidget);

    await tester.tap(find.byTooltip('搜索'));
    await tester.pumpAndSettle();
    tester.widget<TextField>(find.byType(TextField)).controller!.text = '同传';
    await tester.pump();

    await tester.tap(find.text('重试'));
    await tester.pumpAndSettle();

    expect(repository.listCalls, 2);
    expect(repository.queries, <String>['', '同传']);
    expect(find.text('同传记录'), findsOneWidget);
  });

  testWidgets('opens a search result at its matching transcript segment',
      (WidgetTester tester) async {
    final repository = _FakeSessionHistoryRepository();
    await tester.pumpWidget(_TestApp(
      child: SessionHistoryPage(repository: repository),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('搜索'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '既要');
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    await tester.tap(find.text('同传记录'));
    await tester.pumpAndSettle();

    expect(find.text('找到 1 / 2 段'), findsOneWidget);
    expect(find.text('会后发送纪要'), findsOneWidget);
    expect(find.text('今天下午三点开会'), findsNothing);
  });

  testWidgets('debounces rapid input and submits the latest query immediately',
      (WidgetTester tester) async {
    final repository = _FakeSessionHistoryRepository();
    await tester.pumpWidget(_TestApp(
      child: SessionHistoryPage(repository: repository),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('搜索'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '纪');
    await tester.pump(const Duration(milliseconds: 100));
    await tester.enterText(find.byType(TextField), '纪要');
    await tester.pump(const Duration(milliseconds: 100));
    await tester.enterText(find.byType(TextField), '纪要确认');
    await tester.pump(const Duration(milliseconds: 299));
    expect(repository.queries, <String>['']);

    await tester.pump(const Duration(milliseconds: 1));
    await tester.pumpAndSettle();
    expect(repository.queries, <String>['', '纪要确认']);

    await tester.enterText(find.byType(TextField), '立即搜索');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(repository.queries, <String>['', '纪要确认', '立即搜索']);
    await tester.pump(const Duration(milliseconds: 300));
    expect(repository.queries, <String>['', '纪要确认', '立即搜索']);
  });

  testWidgets('closing search clears the hidden record filter',
      (WidgetTester tester) async {
    final repository = _FakeSessionHistoryRepository();
    await tester.pumpWidget(_TestApp(
      child: SessionHistoryPage(repository: repository),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('搜索'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '纪要');
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.byTooltip('清除'));
    await tester.pumpAndSettle();

    expect(find.byType(TextField), findsNothing);
    expect(repository.queries, <String>['', '']);
  });
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
    this.listError,
    this.listFailuresBeforeRecovery,
  }) : super(shareService: _FakeFileShareService());

  final Object? listError;
  final int? listFailuresBeforeRecovery;
  bool generatedReview = false;
  int listCalls = 0;
  final List<String> queries = <String>[];

  @override
  Future<List<SessionListItem>> listSessions({String query = ''}) async {
    listCalls += 1;
    queries.add(query);
    if (listError != null &&
        (listFailuresBeforeRecovery == null ||
            listCalls <= listFailuresBeforeRecovery!)) {
      throw listError!;
    }
    return <SessionListItem>[
      SessionListItem(
        sessionId: 's1',
        mode: 'meeting',
        status: 'ended',
        consumedSeconds: 60,
        createdAt: DateTime.utc(2026, 7, 9, 12),
        endedAt: DateTime.utc(2026, 7, 9, 12, 1),
        segmentCount: 2,
        title: '同传记录',
      ),
      SessionListItem(
        sessionId: 'call_1',
        mode: 'call_link',
        kind: 'call',
        status: 'ended',
        consumedSeconds: 90,
        createdAt: DateTime.utc(2026, 7, 8, 12),
        endedAt: DateTime.utc(2026, 7, 8, 12, 1, 30),
        segmentCount: 3,
        title: '通话记录',
      ),
      SessionListItem(
        sessionId: 'scan_1',
        mode: 'conversation',
        kind: 'scan',
        status: 'ended',
        consumedSeconds: 0,
        createdAt: DateTime.utc(2026, 7, 7, 12),
        endedAt: DateTime.utc(2026, 7, 7, 12),
        segmentCount: 1,
        title: '扫描记录',
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
          rawText: '会后发送既要',
          optimizedText: '会后发送纪要',
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
