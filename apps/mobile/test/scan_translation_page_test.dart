import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/scan/presentation/pages/scan_translation_page.dart';
import 'package:translation_mobile/src/features/scan/presentation/controllers/scan_translation_controller.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_settings_store.dart';
import 'package:translation_mobile/src/platform/ocr/mobile_ocr_provider.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

part 'helpers/scan_translation_page_fakes.dart';

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
        pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
        shareText: (text) async => sharedText = text,
      ),
    ));

    await tester.tap(find.text('相册'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('识别文字'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('翻译'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.ensureVisible(find.text('翻译'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('翻译'));
    await tester.pumpAndSettle();

    expect(find.text('你好'), findsOneWidget);
    expect(find.text('Hello'), findsNWidgets(2));
    expect(find.text('图片对照'), findsOneWidget);
    expect(find.text('文字对照'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('导出'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.drag(find.byType(ListView), const Offset(0, -80));
    await tester.pumpAndSettle();
    await tester.tap(find.text('导出'));
    await tester.pumpAndSettle();

    expect(sharedText, contains('识别文字'));
    expect(sharedText, contains('你好'));
    expect(sharedText, contains('Hello'));

    await tester.scrollUntilVisible(
      find.text('保存记录'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.drag(find.byType(ListView), const Offset(0, -80));
    await tester.pumpAndSettle();
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
        pickImagePath: (_) async => _picked('/tmp/blank.jpg'),
      ),
    ));

    await tester.tap(find.text('拍照'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('识别文字'));
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('未识别到文字，请换一张更清晰的图片'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('未识别到文字，请换一张更清晰的图片'), findsOneWidget);
  });

  testWidgets('keeps the visible scan direction aligned with the target',
      (WidgetTester tester) async {
    await tester.pumpWidget(_TestApp(
      child: ScanTranslationPage(
        ocrProvider: const _FakeOcrProvider('Welcome'),
        translationProvider: _FakeTranslationProvider(),
        historyRepository: _FakeSessionHistoryRepository(),
        pickImagePath: (_) async => _picked('/tmp/sign.jpg'),
      ),
    ));

    await tester.tap(find.text('相册'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('识别文字'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('翻译'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('翻译'));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView), const Offset(0, 600));
    await tester.pumpAndSettle();

    expect(find.textContaining('英文 -> 英文'), findsOneWidget);
    expect(find.text('English'), findsOneWidget);
  });

  testWidgets(
      'keeps target language controls usable on a narrow large-text screen',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_TestApp(
      textScale: 2,
      child: ScanTranslationPage(
        ocrProvider: const _FakeOcrProvider('你好'),
        translationProvider: _FakeTranslationProvider(),
        historyRepository: _FakeSessionHistoryRepository(),
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('中文').last);
    await tester.pumpAndSettle();

    expect(find.text('中文'), findsOneWidget);
    expect(find.text('拍照'), findsOneWidget);
    expect(find.text('相册'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('keeps recognized text when translation is unavailable',
      (WidgetTester tester) async {
    await tester.pumpWidget(_TestApp(
      child: ScanTranslationPage(
        ocrProvider: const _FakeOcrProvider('你好'),
        translationProvider: _FakeTranslationProvider(fail: true),
        historyRepository: _FakeSessionHistoryRepository(),
        pickImagePath: (_) async => _picked('/tmp/offline.jpg'),
      ),
    ));

    await tester.tap(find.text('相册'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('识别文字'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('翻译'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('翻译'));
    await tester.pumpAndSettle();

    expect(find.text('你好'), findsOneWidget);
    expect(find.text('翻译暂不可用，已保留识别文字'), findsOneWidget);
  });

  testWidgets('uses the saved online mode without old private fallback',
      (WidgetTester tester) async {
    const translationChannel =
        MethodChannel('translation_mobile/on_device_translation');
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      translationChannel,
      (call) async {
        if (call.method == 'translate') {
          throw PlatformException(
            code: 'local_translation_unavailable',
            message: 'Synthetic on-device translation unavailable',
          );
        }
        return <String, Object?>{};
      },
    );
    addTearDown(() {
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        translationChannel,
        null,
      );
    });
    await tester.pumpWidget(_TestApp(
      child: ScanTranslationPage(
        config: _localConfig(),
        settingsStore:
            MemoryRealtimeSettingsStore(const RealtimeRuntimeSettings(
          processingMode: RealtimeProcessingMode.online,
          sourceLanguage: 'zh',
          targetLanguage: 'en',
          voiceOutputMode: RealtimeVoiceOutputMode.off,
        )),
        ocrProvider: const _FakeOcrProvider('你好'),
        pickImagePath: (_) async => _picked('/tmp/online.jpg'),
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('相册'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('识别文字'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('翻译'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('翻译'));
    await tester.pumpAndSettle();

    expect(
      find.text('翻译暂不可用，已保留识别文字', skipOffstage: false),
      findsOneWidget,
    );
  });
}
