import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/type_to_speak/presentation/pages/type_to_speak_page.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';
import 'package:translation_mobile/src/platform/speech/speech_output_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

void main() {
  testWidgets('translates typed text and sends it to speech output',
      (WidgetTester tester) async {
    final translator = _FakeTranslationProvider();
    final speaker = _FakeSpeechOutputProvider();
    await tester.pumpWidget(_TestApp(
      child: TypeToSpeakPage(
        translationProvider: translator,
        speechOutputProvider: speaker,
        historyRepository: _FakeSessionHistoryRepository(),
      ),
    ));

    await tester.enterText(find.byType(TextField), '你好');
    await tester.tap(find.text('翻译'));
    await tester.pumpAndSettle();

    expect(find.text('Hello'), findsOneWidget);
    expect(translator.lastSourceLanguage, 'zh');
    expect(translator.lastTargetLanguage, 'en');

    await tester.tap(find.text('朗读译文'));
    await tester.pumpAndSettle();

    expect(speaker.lastText, 'Hello');
    expect(speaker.lastLanguage, 'en');
  });

  testWidgets('keeps translated text visible and normalizes speech text',
      (WidgetTester tester) async {
    final translator = _FakeTranslationProvider();
    final speaker = _FakeSpeechOutputProvider();
    await tester.pumpWidget(_TestApp(
      child: TypeToSpeakPage(
        translationProvider: translator,
        speechOutputProvider: speaker,
        historyRepository: _FakeSessionHistoryRepository(),
      ),
    ));

    await tester.enterText(find.byType(TextField), '订单多少钱');
    await tester.tap(find.text('翻译'));
    await tester.pumpAndSettle();

    const translated = 'Order SKU A-120 costs \$31.50, call 138-0013-8000.';
    expect(find.text(translated), findsOneWidget);

    await tester.tap(find.text('朗读译文'));
    await tester.pumpAndSettle();

    expect(
      speaker.lastText,
      'Order SKU A one two zero costs 31.50 dollars, call one three eight zero zero one three eight zero zero zero.',
    );
    expect(speaker.lastLanguage, 'en');
  });

  testWidgets('saves translated text to history', (WidgetTester tester) async {
    final translator = _FakeTranslationProvider();
    final speaker = _FakeSpeechOutputProvider();
    final history = _FakeSessionHistoryRepository();
    await tester.pumpWidget(_TestApp(
      child: TypeToSpeakPage(
        translationProvider: translator,
        speechOutputProvider: speaker,
        historyRepository: history,
      ),
    ));

    await tester.enterText(find.byType(TextField), '你好');
    await tester.tap(find.text('翻译'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('保存记录'));
    await tester.pumpAndSettle();

    expect(history.savedSourceText, '你好');
    expect(history.savedTranslatedText, 'Hello');
    expect(history.savedSourceLanguage, 'zh');
    expect(history.savedTargetLanguage, 'en');
    expect(find.text('已保存到记录'), findsOneWidget);
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

class _FakeTranslationProvider implements MobileTranslationProvider {
  String? lastSourceLanguage;
  String? lastTargetLanguage;

  @override
  Future<void> dispose() async {}

  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    lastSourceLanguage = config.sourceLanguage;
    lastTargetLanguage = config.targetLanguage;
    if (text.trim() == '你好') {
      return const MobileTranslationResult(
        text: 'Hello',
        provider: 'fake',
      );
    }
    if (text.trim() == '订单多少钱') {
      return const MobileTranslationResult(
        text: 'Order SKU A-120 costs \$31.50, call 138-0013-8000.',
        provider: 'fake',
      );
    }
    return null;
  }
}

class _FakeSpeechOutputProvider implements SpeechOutputProvider {
  String? lastText;
  String? lastLanguage;

  @override
  Future<SpeechOutputResult> speak({
    required String text,
    required String language,
  }) async {
    lastText = text;
    lastLanguage = language;
    return SpeechOutputResult(provider: 'fake_tts', language: language);
  }

  @override
  Future<void> stop() async {}
}

class _FakeSessionHistoryRepository extends SessionHistoryRepository {
  _FakeSessionHistoryRepository()
      : super(shareService: _FakeFileShareService());

  String? savedSourceText;
  String? savedTranslatedText;
  String? savedSourceLanguage;
  String? savedTargetLanguage;

  @override
  Future<SessionDetail> saveTypeToSpeakSession({
    required String sourceText,
    required String translatedText,
    required String sourceLanguage,
    required String targetLanguage,
  }) async {
    savedSourceText = sourceText;
    savedTranslatedText = translatedText;
    savedSourceLanguage = sourceLanguage;
    savedTargetLanguage = targetLanguage;
    return SessionDetail(
      sessionId: 'typed_1',
      mode: 'conversation',
      status: 'ended',
      consumedSeconds: 0,
      createdAt: DateTime.utc(2026, 7, 5),
      endedAt: DateTime.utc(2026, 7, 5),
      segmentCount: 1,
      segments: <SessionSegment>[
        SessionSegment(
          id: 'typed_1',
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
