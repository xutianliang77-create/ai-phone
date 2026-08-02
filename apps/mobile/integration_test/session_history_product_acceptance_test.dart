import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/history/presentation/pages/session_history_page.dart';
import 'package:translation_mobile/src/features/shell/presentation/pages/settings_home_page.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('validates a 120-segment record across all detail entrances',
      (tester) async {
    binding.testTextInput.register();
    addTearDown(binding.testTextInput.unregister);
    final repository = _LongRecordRepository();

    await tester.pumpWidget(_TestApp(
      child: SessionHistoryPage(repository: repository),
    ));
    await tester.pumpAndSettle();

    expect(find.text('120 段会议验收记录'), findsOneWidget);
    await tester.tap(find.byTooltip('搜索'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '既要');
    await tester.pump(const Duration(milliseconds: 350));
    await tester.pumpAndSettle();
    expect(repository.queries, <String>['', '既要']);

    await tester.tap(find.text('120 段会议验收记录'));
    await tester.pumpAndSettle();
    expect(find.text('找到 1 / 120 段'), findsOneWidget);
    expect(find.text('会议纪要已经发送'), findsOneWidget);
    expect(find.text('会议既要已经发送'), findsNothing);

    await tester.tap(
      find.byKey(const ValueKey('transcript-raw-toggle-long-0')),
    );
    await tester.pumpAndSettle();
    expect(find.text('会议既要已经发送'), findsOneWidget);

    await tester.tap(find.widgetWithText(Tab, '纪要'));
    await tester.pumpAndSettle();
    expect(find.textContaining('120 段会议的正式纪要'), findsOneWidget);

    await tester.tap(find.widgetWithText(Tab, '术语'));
    await tester.pumpAndSettle();
    expect(find.text('流式字幕'), findsOneWidget);
    expect(find.text('streaming captions'), findsOneWidget);

    await tester.tap(find.widgetWithText(Tab, '待办'));
    await tester.pumpAndSettle();
    expect(find.text('会后发送正式纪要'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('action-item-0')));
    await tester.pumpAndSettle();
    expect(repository.actionUpdates, <bool>[true]);

    await tester.tap(find.byTooltip('导出'));
    await tester.pumpAndSettle();
    for (final format in <String>['Markdown', '纯文本', 'JSON', 'CSV']) {
      expect(find.text(format), findsOneWidget);
    }
    await tester.tap(find.text('JSON'));
    await tester.pumpAndSettle();
    expect(repository.exportFormats, <String>['json']);

    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(find.text('120 段会议验收记录'), findsOneWidget);
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text,
        '既要');
    expect(repository.queries.last, '既要');

    await tester.tap(find.byTooltip('清除'));
    await tester.pumpAndSettle();
    expect(find.byType(TextField), findsNothing);
    expect(repository.queries.last, '');

    debugPrint('LONG_RECORD_DEVICE_RESULT ${jsonEncode(<String, Object?>{
          'segmentCount': 120,
          'carriedQuery': '既要',
          'tabs': <String>['全文', '纪要', '术语', '待办'],
          'rawExpansion': true,
          'actionPersistence': true,
          'exportFormatsVisible': <String>['markdown', 'txt', 'json', 'csv'],
          'queryRetainedAfterBack': true,
          'closeRestoredFullList': true,
        })}');
  });

  testWidgets('keeps the visible release identity aligned with build inputs',
      (tester) async {
    const appVersion = String.fromEnvironment(
      'APP_VERSION',
      defaultValue: '0.1.0',
    );
    const buildNumber = String.fromEnvironment(
      'BUILD_NUMBER',
      defaultValue: '1',
    );
    final config = AppConfig.fromEnvironment();

    await tester.pumpWidget(_TestApp(
      child: SettingsHomePage(config: config),
    ));
    await tester.pumpAndSettle();
    const releaseIdentity = '版本 $appVersion（构建 $buildNumber）';
    await tester.scrollUntilVisible(
      find.text(releaseIdentity),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('无界AI'), findsOneWidget);
    expect(find.text(releaseIdentity), findsOneWidget);
    expect(find.text('国内版 · 中英优先 · PSTN 暂未开放'), findsOneWidget);
    expect(find.textContaining(config.apiBaseUrl.host), findsNothing);

    debugPrint('RELEASE_IDENTITY_DEVICE_RESULT ${jsonEncode(<String, Object?>{
          'appTitle': '无界AI',
          'appVersion': appVersion,
          'buildNumber': buildNumber,
          'region': 'domestic',
          'internalAddressVisible': false,
        })}');
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

class _LongRecordRepository extends SessionHistoryRepository {
  _LongRecordRepository() : super(shareService: _NoopFileShareService());

  final List<String> queries = <String>[];
  final List<bool> actionUpdates = <bool>[];
  final List<String> exportFormats = <String>[];
  bool actionCompleted = false;

  @override
  Future<List<SessionListItem>> listSessions({String query = ''}) async {
    queries.add(query);
    return <SessionListItem>[
      SessionListItem(
        sessionId: 'long-session',
        mode: 'meeting',
        status: 'ended',
        consumedSeconds: 600,
        createdAt: DateTime.utc(2026, 8, 2, 12),
        endedAt: DateTime.utc(2026, 8, 2, 12, 10),
        segmentCount: 120,
        speakerCount: 2,
        sourceLanguage: 'zh',
        targetLanguage: 'en',
        title: '120 段会议验收记录',
      ),
    ];
  }

  @override
  Future<SessionDetail> getSession(String sessionId) async => _detail();

  @override
  Future<SessionDetail> updateActionItem(
    String sessionId,
    int actionIndex,
    bool completed,
  ) async {
    actionUpdates.add(completed);
    actionCompleted = completed;
    return _detail();
  }

  @override
  Future<void> shareExport(
    String sessionId, {
    String format = 'markdown',
  }) async {
    exportFormats.add(format);
  }

  SessionDetail _detail() {
    return SessionDetail(
      sessionId: 'long-session',
      mode: 'meeting',
      status: 'ended',
      consumedSeconds: 600,
      createdAt: DateTime.utc(2026, 8, 2, 12),
      endedAt: DateTime.utc(2026, 8, 2, 12, 10),
      segmentCount: 120,
      reviewJson: <String, Object?>{
        'summary': '120 段会议的正式纪要',
        'highlights': <Map<String, Object?>>[],
        'terms': <Map<String, Object?>>[
          <String, Object?>{
            'sourceText': '流式字幕',
            'translatedText': 'streaming captions',
          },
        ],
        'actionItems': <Map<String, Object?>>[
          <String, Object?>{
            'text': '会后发送正式纪要',
            'completed': actionCompleted,
          },
        ],
      },
      segments: <SessionSegment>[
        const SessionSegment(
          id: 'long-0',
          sourceText: '会议纪要已经发送',
          rawText: '会议既要已经发送',
          optimizedText: '会议纪要已经发送',
          translatedText: 'The meeting notes were sent',
        ),
        const SessionSegment(
          id: 'long-1',
          sourceText: '预算是二十万元',
          translatedText: 'The budget is 200,000 yuan',
        ),
        for (var index = 2; index < 120; index += 1)
          SessionSegment(
            id: 'long-$index',
            sourceText: '第 $index 段会议内容',
            translatedText: 'Meeting segment $index',
          ),
      ],
    );
  }
}

class _NoopFileShareService implements FileShareService {
  @override
  Future<String> saveExportFile(List<int> bytes, String filename) async {
    return filename;
  }

  @override
  Future<void> shareFile(String path, {String? mimeType}) async {}
}
