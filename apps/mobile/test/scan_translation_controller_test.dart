import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/scan/presentation/controllers/scan_translation_controller.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';
import 'package:translation_mobile/src/platform/ocr/mobile_ocr_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

void main() {
  test('scans image text and translates with auto direction', () async {
    final translator = _FakeTranslationProvider();
    final history = _FakeSessionHistoryRepository();
    final controller = ScanTranslationController(
      ocrProvider: const _FakeOcrProvider('你好'),
      translationProvider: translator,
      pickImagePath: (_) async => '/tmp/menu.jpg',
      historyRepository: history,
    );

    await controller.scan(ScanImageSource.gallery);
    await controller.save();

    expect(controller.status, ScanTranslationStatus.saved);
    expect(controller.recognizedText, '你好');
    expect(controller.translatedText, 'Hello');
    expect(translator.lastSourceLanguage, 'zh');
    expect(translator.lastTargetLanguage, 'en');
    expect(history.savedSourceText, '你好');
    expect(history.savedTranslatedText, 'Hello');
    expect(history.savedSourceKind, 'scan');
    expect(controller.savedSessionId, 'scan_1');
  });

  test('keeps recognized text when translation is unavailable', () async {
    final controller = ScanTranslationController(
      ocrProvider: const _FakeOcrProvider('未收录菜单'),
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) async => '/tmp/menu.jpg',
      historyRepository: _FakeSessionHistoryRepository(),
    );

    await controller.scan(ScanImageSource.camera);

    expect(controller.status, ScanTranslationStatus.recognized);
    expect(controller.recognizedText, '未收录菜单');
    expect(controller.message, 'scan_translation_unavailable');
  });

  test('reports no text when OCR result is empty', () async {
    final controller = ScanTranslationController(
      ocrProvider: const _FakeOcrProvider(''),
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) async => '/tmp/blank.jpg',
      historyRepository: _FakeSessionHistoryRepository(),
    );

    await controller.scan(ScanImageSource.gallery);

    expect(controller.status, ScanTranslationStatus.failed);
    expect(controller.message, 'scan_no_text');
  });
}

class _FakeSessionHistoryRepository extends SessionHistoryRepository {
  _FakeSessionHistoryRepository()
      : super(shareService: _FakeFileShareService());

  String? savedSourceText;
  String? savedTranslatedText;
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
    savedSourceKind = sourceKind;
    return SessionDetail(
      sessionId: 'scan_1',
      mode: 'conversation',
      status: 'ended',
      consumedSeconds: 0,
      createdAt: DateTime.utc(2026, 7, 5),
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
    if (text == '你好') {
      return const MobileTranslationResult(text: 'Hello', provider: 'fake');
    }
    return null;
  }
}
