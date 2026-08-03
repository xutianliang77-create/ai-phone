import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/scan/presentation/controllers/scan_translation_controller.dart';
import 'package:translation_mobile/src/platform/ocr/mobile_ocr_provider.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

void main() {
  test('protects mixed manufacturer model and numeric entities', () async {
    const source = '制造商 Dell Technologies 型号 DPS-750AB-29A 输入 100-240V';
    final translator = _EntityEchoTranslationProvider();
    final controller = ScanTranslationController(
      ocrProvider: const _FakeOcrProvider(source),
      translationProvider: translator,
      pickImagePath: (_) async => _picked('/tmp/label.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
    );

    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();
    await controller.translateRecognizedText();

    expect(translator.input, isNot(contains('Dell Technologies')));
    expect(translator.input, isNot(contains('DPS-750AB-29A')));
    expect(translator.input, isNot(contains('100-240V')));
    expect(controller.translatedText, contains('Dell Technologies'));
    expect(controller.translatedText, contains('DPS-750AB-29A'));
    expect(controller.translatedText, contains('100-240V'));
  });

  test('bypasses translation for a standalone certification mark', () async {
    final controller = ScanTranslationController(
      ocrProvider: const _FakeOcrProvider('CE'),
      translationProvider: _ThrowingTranslationProvider(),
      pickImagePath: (_) async => _picked('/tmp/label.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
    );
    controller.setTargetLanguage('zh');

    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();
    await controller.translateRecognizedText();

    expect(controller.status, ScanTranslationStatus.translated);
    expect(controller.translatedText, 'CE');
  });

  test('normalizes the Vision CE confusable before translation', () async {
    final controller = ScanTranslationController(
      ocrProvider: const _FakeOcrProvider('C€'),
      translationProvider: _ThrowingTranslationProvider(),
      pickImagePath: (_) async => _picked('/tmp/label.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
    );
    controller.setTargetLanguage('zh');

    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();
    await controller.translateRecognizedText();

    expect(controller.recognizedText, 'CE');
    expect(controller.recognizedBlocks.single.text, 'CE');
    expect(controller.status, ScanTranslationStatus.translated);
    expect(controller.translatedText, 'CE');
  });
}

PickedScanImage _picked(String path) {
  return PickedScanImage(
    path: path,
    previewBytes: Uint8List.fromList(<int>[1]),
  );
}

class _FakeSessionHistoryRepository extends SessionHistoryRepository {
  _FakeSessionHistoryRepository()
      : super(shareService: _FakeFileShareService());

  @override
  Future<SessionDetail> saveTextTranslationSession({
    required String sourceText,
    required String translatedText,
    required String sourceLanguage,
    required String targetLanguage,
    required String sourceKind,
  }) async {
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
  Future<MobileOcrResult?> recognizeImage(
    String imagePath, {
    List<String>? preferredScripts,
  }) async {
    return MobileOcrResult(
      text: text,
      provider: 'fake',
      blocks: <MobileOcrBlock>[
        MobileOcrBlock(
          text: text,
          left: 0.1,
          top: 0.2,
          width: 0.5,
          height: 0.2,
        ),
      ],
    );
  }
}

class _ThrowingTranslationProvider implements MobileTranslationProvider {
  @override
  Future<void> dispose() async {}

  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) {
    throw StateError('translation provider offline');
  }
}

class _EntityEchoTranslationProvider implements MobileTranslationProvider {
  String input = '';

  @override
  Future<void> dispose() async {}

  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    input = text;
    return MobileTranslationResult(
      text: text
          .replaceAll('制造商', 'Manufacturer')
          .replaceAll('型号', 'model')
          .replaceAll('输入', 'input'),
      provider: 'entity_echo',
    );
  }
}
