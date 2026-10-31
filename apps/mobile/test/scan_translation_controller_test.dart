import 'dart:async';
import 'dart:typed_data';

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
      detectLanguage: _fixtureLanguage,
      ocrProvider: const _FakeOcrProvider('你好'),
      translationProvider: translator,
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: history,
    );

    await controller.selectImage(ScanImageSource.gallery);
    expect(controller.status, ScanTranslationStatus.imageSelected);
    expect(controller.recognizedText, isEmpty);
    await controller.recognizeSelectedImage();
    expect(controller.status, ScanTranslationStatus.recognized);
    await controller.translateRecognizedText();
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
      detectLanguage: _fixtureLanguage,
      ocrProvider: const _FakeOcrProvider('未收录菜单'),
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
    );

    await controller.selectImage(ScanImageSource.camera);
    await controller.recognizeSelectedImage();
    await controller.translateRecognizedText();

    expect(controller.status, ScanTranslationStatus.recognized);
    expect(controller.recognizedText, '未收录菜单');
    expect(controller.message, 'scan_translation_unavailable');
  });

  test('does not silently change the selected target language', () async {
    final translator = _FakeTranslationProvider();
    final controller = ScanTranslationController(
      detectLanguage: _fixtureLanguage,
      ocrProvider: const _FakeOcrProvider('Welcome'),
      translationProvider: translator,
      pickImagePath: (_) async => _picked('/tmp/sign.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
    );

    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();
    await controller.translateRecognizedText();

    expect(controller.targetLanguage, 'en');
    expect(controller.translatedText, 'Welcome');
    expect(controller.status, ScanTranslationStatus.translated);
    expect(translator.lastTargetLanguage, isNull);
  });

  test('prioritizes the likely source script from the selected target',
      () async {
    final englishSourceOcr = _RecordingOcrProvider('Welcome');
    final toChinese = ScanTranslationController(
      detectLanguage: _fixtureLanguage,
      ocrProvider: englishSourceOcr,
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
    );
    toChinese.setTargetLanguage('zh');

    await toChinese.selectImage(ScanImageSource.gallery);
    await toChinese.recognizeSelectedImage();

    expect(
      englishSourceOcr.lastPreferredScripts,
      <String>['latin', 'chinese'],
    );

    final chineseSourceOcr = _RecordingOcrProvider('菜单');
    final toEnglish = ScanTranslationController(
      detectLanguage: _fixtureLanguage,
      ocrProvider: chineseSourceOcr,
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
    );

    await toEnglish.selectImage(ScanImageSource.gallery);
    await toEnglish.recognizeSelectedImage();

    expect(
      chineseSourceOcr.lastPreferredScripts,
      <String>['chinese', 'latin'],
    );
  });

  test('keeps a completed translation when the target is unchanged', () async {
    final controller = ScanTranslationController(
      detectLanguage: _fixtureLanguage,
      ocrProvider: const _FakeOcrProvider('你好'),
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
    );

    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();
    await controller.translateRecognizedText();
    controller.setTargetLanguage('en');

    expect(controller.status, ScanTranslationStatus.translated);
    expect(controller.translatedText, 'Hello');
  });

  test('new image does not display the previous automatic language', () async {
    final controller = ScanTranslationController(
      detectLanguage: _fixtureLanguage,
      ocrProvider: const _FakeOcrProvider('你好'),
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
    );
    addTearDown(controller.dispose);
    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();
    await controller.translateRecognizedText();
    expect(controller.sourceLanguage, 'zh');
    await controller.selectImage(ScanImageSource.camera);
    expect(controller.sourceLanguage, 'auto');
    expect(controller.selectedSourceLanguage, 'auto');
  });

  test('successful re-recognition clears the previous detected language', () async {
    final controller = ScanTranslationController(
      detectLanguage: _fixtureLanguage,
      ocrProvider: _SequenceOcrProvider(),
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
    );
    addTearDown(controller.dispose);
    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();
    await controller.translateRecognizedText();
    expect(controller.sourceLanguage, 'zh');
    await controller.recognizeSelectedImage();
    expect(controller.recognizedText, 'Welcome');
    expect(controller.sourceLanguage, 'auto');
  });

  test('clears a stale translation error after changing the target', () async {
    final controller = ScanTranslationController(
      detectLanguage: _fixtureLanguage,
      ocrProvider: const _FakeOcrProvider('未收录菜单'),
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
    );

    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();
    await controller.translateRecognizedText();
    expect(controller.message, 'scan_translation_unavailable');

    controller.setTargetLanguage('zh');

    expect(controller.targetLanguage, 'zh');
    expect(controller.recognizedText, '未收录菜单');
    expect(controller.message, isNull);
    expect(controller.status, ScanTranslationStatus.recognized);
  });

  test('reports no text when OCR result is empty', () async {
    final controller = ScanTranslationController(
      detectLanguage: _fixtureLanguage,
      ocrProvider: const _FakeOcrProvider(''),
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) async => _picked('/tmp/blank.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
    );

    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();

    expect(controller.status, ScanTranslationStatus.failed);
    expect(controller.message, 'scan_no_text');
  });

  test('reports image picker failures without remaining busy', () async {
    final controller = ScanTranslationController(
      detectLanguage: _fixtureLanguage,
      ocrProvider: const _FakeOcrProvider(''),
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) => Future<PickedScanImage?>.error(
        StateError('photo permission denied'),
      ),
      historyRepository: _FakeSessionHistoryRepository(),
    );

    await controller.selectImage(ScanImageSource.gallery);

    expect(controller.status, ScanTranslationStatus.failed);
    expect(controller.message, 'scan_image_pick_failed');
    expect(controller.isBusy, isFalse);
  });

  test('failed preview keeps the previous image and completed results', () async {
    var pickCount = 0;
    final controller = ScanTranslationController(
      detectLanguage: _fixtureLanguage,
      ocrProvider: const _FakeOcrProvider('你好'),
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) async {
        if (pickCount++ == 0) return _picked('/tmp/first.jpg');
        throw const ScanImageReadFailure();
      },
      historyRepository: _FakeSessionHistoryRepository(),
    );
    addTearDown(controller.dispose);
    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();
    await controller.translateRecognizedText();
    await controller.selectImage(ScanImageSource.camera);

    expect(controller.imagePath, '/tmp/first.jpg');
    expect(controller.recognizedText, '你好');
    expect(controller.translatedText, 'Hello');
    expect(controller.message, 'scan_image_read_failed');
    expect(controller.isBusy, isFalse);
  });

  test('authorization timeout before OCR is not reported as OCR failure', () async {
    final ocr = _RecordingOcrProvider('你好');
    final controller = ScanTranslationController(
      ocrProvider: ocr,
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
      startAuthorization: () async => throw TimeoutException('private detail'),
    );
    addTearDown(controller.dispose);
    await controller.selectImage(ScanImageSource.camera);
    await controller.recognizeSelectedImage();

    expect(ocr.calls, 0);
    expect(controller.imagePath, '/tmp/menu.jpg');
    expect(controller.message, 'scan_ocr_authorization_unavailable');
    expect(controller.isBusy, isFalse);
  });

  test('known authorization failure keeps its actionable message', () async {
    final ocr = _RecordingOcrProvider('你好');
    final controller = ScanTranslationController(
      ocrProvider: ocr,
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
      startAuthorization: () async => throw StateError('authorization_required'),
    );
    addTearDown(controller.dispose);
    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();

    expect(ocr.calls, 0);
    expect(controller.message, contains('授权'));
  });

  test('authorization timeout before translation preserves OCR text', () async {
    var shouldFail = false;
    final translator = _FakeTranslationProvider();
    final controller = ScanTranslationController(
      detectLanguage: _fixtureLanguage,
      ocrProvider: const _FakeOcrProvider('你好'),
      translationProvider: translator,
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
      startAuthorization: () async {
        if (shouldFail) throw TimeoutException('private detail');
        return 'lease';
      },
      verifyAuthorization: (_) async {},
    );
    addTearDown(controller.dispose);
    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();
    shouldFail = true;
    await controller.translateRecognizedText();

    expect(controller.recognizedText, '你好');
    expect(controller.translatedText, isEmpty);
    expect(translator.lastSourceLanguage, isNull);
    expect(controller.message, 'scan_translation_authorization_unavailable');
    expect(controller.isBusy, isFalse);
  });

  test('failed completion authorization does not publish new OCR results', () async {
    final controller = ScanTranslationController(
      ocrProvider: const _FakeOcrProvider('你好'),
      translationProvider: _FakeTranslationProvider(),
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
      startAuthorization: () async => 'lease',
      verifyAuthorization: (_) async => throw StateError('private detail'),
    );
    addTearDown(controller.dispose);
    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();

    expect(controller.recognizedText, isEmpty);
    expect(controller.imagePath, '/tmp/menu.jpg');
    expect(controller.message, 'scan_authorization_result_unverified');
  });

  test('failed completion authorization does not publish a translation', () async {
    var verifyFails = false;
    final translator = _FakeTranslationProvider();
    final controller = ScanTranslationController(
      detectLanguage: _fixtureLanguage,
      ocrProvider: const _FakeOcrProvider('你好'),
      translationProvider: translator,
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
      startAuthorization: () async => 'lease',
      verifyAuthorization: (_) async {
        if (verifyFails) throw StateError('private detail');
      },
    );
    addTearDown(controller.dispose);
    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();
    verifyFails = true;
    await controller.translateRecognizedText();

    expect(translator.lastSourceLanguage, 'zh');
    expect(controller.recognizedText, '你好');
    expect(controller.translatedText, isEmpty);
    expect(controller.message, 'scan_authorization_result_unverified');
    expect(controller.isBusy, isFalse);
  });

  test('language detector failure is distinct from translation failure', () async {
    final translator = _FakeTranslationProvider();
    final controller = ScanTranslationController(
      detectLanguage: (_) async => throw StateError('private detail'),
      ocrProvider: const _FakeOcrProvider('你好'),
      translationProvider: translator,
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
    );
    addTearDown(controller.dispose);
    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();
    await controller.translateRecognizedText();

    expect(controller.recognizedText, '你好');
    expect(translator.lastSourceLanguage, isNull);
    expect(controller.message, 'scan_language_detection_failed');
    controller.setSourceLanguage('zh');
    await controller.translateRecognizedText();
    expect(controller.translatedText, 'Hello');
  });

  test('keeps OCR text when the translation provider throws', () async {
    final controller = ScanTranslationController(
      detectLanguage: _fixtureLanguage,
      ocrProvider: const _FakeOcrProvider('菜单'),
      translationProvider: _ThrowingTranslationProvider(),
      pickImagePath: (_) async => _picked('/tmp/menu.jpg'),
      historyRepository: _FakeSessionHistoryRepository(),
    );

    await controller.selectImage(ScanImageSource.gallery);
    await controller.recognizeSelectedImage();
    await controller.translateRecognizedText();

    expect(controller.status, ScanTranslationStatus.recognized);
    expect(controller.recognizedText, '菜单');
    expect(controller.message, 'scan_translation_unavailable');
    expect(controller.isBusy, isFalse);
  });
}

PickedScanImage _picked(String path) {
  return PickedScanImage(
      path: path, previewBytes: Uint8List.fromList(<int>[1]));
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
  Future<MobileOcrResult?> recognizeImage(
    String imagePath, {
    List<String>? preferredScripts,
  }) async {
    return MobileOcrResult(
      text: text,
      provider: 'fake',
      blocks: text.isEmpty
          ? const <MobileOcrBlock>[]
          : <MobileOcrBlock>[
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

class _SequenceOcrProvider implements MobileOcrProvider {
  int calls = 0;
  @override
  Future<MobileOcrResult?> recognizeImage(
    String imagePath, {
    List<String>? preferredScripts,
  }) async => MobileOcrResult(
    text: calls++ == 0 ? '你好' : 'Welcome',
    provider: 'fixture',
  );

  @override
  Future<void> dispose() async {}
}

class _RecordingOcrProvider implements MobileOcrProvider {
  _RecordingOcrProvider(this.text);

  final String text;
  List<String>? lastPreferredScripts;
  int calls = 0;

  @override
  Future<void> dispose() async {}

  @override
  Future<MobileOcrResult?> recognizeImage(
    String imagePath, {
    List<String>? preferredScripts,
  }) async {
    calls++;
    lastPreferredScripts = preferredScripts;
    return MobileOcrResult(text: text, provider: 'recording');
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

Future<String?> _fixtureLanguage(String text) async =>
    RegExp(r'[\u4e00-\u9fff]').hasMatch(text) ? 'zh' : 'en';
