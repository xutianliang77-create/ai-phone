import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/scan/presentation/pages/scan_translation_page.dart';
import 'package:translation_mobile/src/platform/ocr/mobile_ocr_provider.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

void main() {
  testWidgets('scans image text, translates it, and shares both',
      (WidgetTester tester) async {
    var sharedText = '';
    final history = _FakeSessionHistoryRepository();
    await tester.pumpWidget(_TestApp(
      child: ScanTranslationPage(
        ocrProvider: const _FakeOcrProvider('你好'),
        translationProvider: _FakeTranslationProvider(),
        historyRepository: history,
        pickImagePath: (_) async => '/tmp/menu.jpg',
        shareText: (text) async => sharedText = text,
      ),
    ));

    await tester.tap(find.text('相册'));
    await tester.pumpAndSettle();

    expect(find.text('你好'), findsOneWidget);
    expect(find.text('Hello'), findsOneWidget);

    await tester.tap(find.text('导出'));
    await tester.pumpAndSettle();

    expect(sharedText, contains('识别文字'));
    expect(sharedText, contains('你好'));
    expect(sharedText, contains('Hello'));

    await tester.tap(find.text('保存记录'));
    await tester.pumpAndSettle();

    expect(history.savedSourceText, '你好');
    expect(history.savedTranslatedText, 'Hello');
    expect(history.savedSourceLanguage, 'zh');
    expect(history.savedTargetLanguage, 'en');
    expect(history.savedSourceKind, 'scan');
    expect(find.text('已保存到记录'), findsOneWidget);
  });

  testWidgets('shows OCR empty-state message', (WidgetTester tester) async {
    await tester.pumpWidget(_TestApp(
      child: ScanTranslationPage(
        ocrProvider: const _FakeOcrProvider(''),
        translationProvider: _FakeTranslationProvider(),
        historyRepository: _FakeSessionHistoryRepository(),
        pickImagePath: (_) async => '/tmp/blank.jpg',
      ),
    ));

    await tester.tap(find.text('拍照'));
    await tester.pumpAndSettle();

    expect(find.text('未识别到文字，请换一张更清晰的图片'), findsOneWidget);
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

class _FakeOcrProvider implements MobileOcrProvider {
  const _FakeOcrProvider(this.text);

  final String text;

  @override
  Future<void> dispose() async {}

  @override
  Future<MobileOcrResult?> recognizeImage(String imagePath) async {
    return MobileOcrResult(text: text, provider: 'fake');
  }
}

class _FakeTranslationProvider implements MobileTranslationProvider {
  @override
  Future<void> dispose() async {}

  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    if (text == '你好') {
      return const MobileTranslationResult(text: 'Hello', provider: 'fake');
    }
    return null;
  }
}

class _FakeSessionHistoryRepository extends SessionHistoryRepository {
  _FakeSessionHistoryRepository()
      : super(shareService: _FakeFileShareService());

  String? savedSourceText;
  String? savedTranslatedText;
  String? savedSourceLanguage;
  String? savedTargetLanguage;
  String? savedSourceKind;

  @override
  Future<SessionDetail> saveTextTranslationSession({
    required String sourceText,
    required String translatedText,
    required String sourceLanguage,
    required String targetLanguage,
    required String sourceKind,
  }) async {
    savedSourceText = sourceText;
    savedTranslatedText = translatedText;
    savedSourceLanguage = sourceLanguage;
    savedTargetLanguage = targetLanguage;
    savedSourceKind = sourceKind;
    return SessionDetail(
      sessionId: 'scan_1',
      mode: 'conversation',
      status: 'ended',
      consumedSeconds: 0,
      createdAt: DateTime.utc(2026, 7, 5),
      endedAt: DateTime.utc(2026, 7, 5),
      segmentCount: 1,
      segments: <SessionSegment>[
        SessionSegment(
          id: 'scan_1',
          sourceText: sourceText,
          translatedText: translatedText,
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
