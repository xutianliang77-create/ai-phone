import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/history/presentation/pages/session_detail_page.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';

void main() {
  testWidgets('keeps review surfaces reachable when transcript is empty',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(_TestApp(
      child: SessionDetailPage(
        sessionId: 'empty-transcript',
        repository: _EmptyTranscriptRepository(),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.widgetWithText(Tab, '全文'), findsOneWidget);
    expect(find.widgetWithText(Tab, '纪要'), findsOneWidget);
    expect(find.widgetWithText(Tab, '术语'), findsOneWidget);
    expect(find.widgetWithText(Tab, '待办'), findsOneWidget);
    expect(find.text('没有保存的字幕'), findsOneWidget);

    await tester.tap(find.widgetWithText(Tab, '纪要'));
    await tester.pumpAndSettle();
    expect(find.text('已生成的服务端纪要'), findsOneWidget);

    await tester.tap(find.widgetWithText(Tab, '术语'));
    await tester.pumpAndSettle();
    expect(find.text('产品型号'), findsOneWidget);
    expect(find.text('product model'), findsOneWidget);

    await tester.tap(find.widgetWithText(Tab, '待办'));
    await tester.pumpAndSettle();
    expect(find.text('发送会议纪要'), findsOneWidget);
    expect(tester.takeException(), isNull);
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
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: const TextScaler.linear(2),
        ),
        child: child!,
      ),
      home: child,
    );
  }
}

class _EmptyTranscriptRepository extends SessionHistoryRepository {
  _EmptyTranscriptRepository() : super(shareService: _FakeShareService());

  @override
  Future<SessionDetail> getSession(String sessionId) async {
    return SessionDetail(
      sessionId: sessionId,
      mode: 'meeting',
      status: 'ended',
      consumedSeconds: 60,
      createdAt: DateTime.utc(2026, 8, 2),
      segmentCount: 0,
      segments: const <SessionSegment>[],
      reviewJson: const <String, Object?>{
        'summary': '已生成的服务端纪要',
        'highlights': <Map<String, Object?>>[],
        'terms': <Map<String, Object?>>[
          <String, Object?>{
            'sourceText': '产品型号',
            'translatedText': 'product model',
          },
        ],
        'actionItems': <Map<String, Object?>>[
          <String, Object?>{
            'text': '发送会议纪要',
            'completed': false,
          },
        ],
      },
    );
  }
}

class _FakeShareService implements FileShareService {
  @override
  Future<String> saveExportFile(List<int> bytes, String filename) async {
    return filename;
  }

  @override
  Future<void> shareFile(String path, {String? mimeType}) async {}
}
