import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/history/presentation/pages/session_detail_page.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';

void main() {
  testWidgets('shows a localized error and restores export after failure',
      (WidgetTester tester) async {
    final repository = _ExportRepository(
      exportError: Exception('ClientException: failed host lookup'),
    );
    await tester.pumpWidget(_TestApp(
      child: SessionDetailPage(sessionId: 's1', repository: repository),
    ));
    await tester.pumpAndSettle();

    await _selectExport(tester, 'Markdown');

    expect(repository.formats, <String>['markdown']);
    expect(find.text('网络连接失败，请检查 API 服务是否可用'), findsOneWidget);
    expect(tester.takeException(), isNull);
    expect(
      tester
          .widget<PopupMenuButton<String>>(
            find.byType(PopupMenuButton<String>),
          )
          .enabled,
      isTrue,
    );
  });

  testWidgets('keeps successful export unchanged', (WidgetTester tester) async {
    final repository = _ExportRepository();
    await tester.pumpWidget(_TestApp(
      child: SessionDetailPage(sessionId: 's1', repository: repository),
    ));
    await tester.pumpAndSettle();

    await _selectExport(tester, '纯文本');

    expect(repository.formats, <String>['txt']);
    expect(tester.takeException(), isNull);
  });
}

Future<void> _selectExport(WidgetTester tester, String format) async {
  await tester.tap(find.byTooltip('导出'));
  await tester.pumpAndSettle();
  await tester.tap(find.text(format));
  await tester.pumpAndSettle();
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

class _ExportRepository extends SessionHistoryRepository {
  _ExportRepository({this.exportError})
      : super(shareService: _NoopFileShareService());

  final Object? exportError;
  final List<String> formats = <String>[];

  @override
  Future<SessionDetail> getSession(String sessionId) async {
    return SessionDetail(
      sessionId: sessionId,
      mode: 'meeting',
      status: 'ended',
      consumedSeconds: 60,
      createdAt: DateTime.utc(2026, 8, 2),
      segmentCount: 1,
      segments: const <SessionSegment>[
        SessionSegment(
          id: '1',
          sourceText: '测试导出',
          translatedText: 'Test export',
        ),
      ],
    );
  }

  @override
  Future<void> shareExport(
    String sessionId, {
    String format = 'markdown',
  }) async {
    formats.add(format);
    if (exportError != null) throw exportError!;
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
