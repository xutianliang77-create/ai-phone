import 'package:flutter/foundation.dart';

import '../../../history/data/session_history_repository.dart';
import '../../../../platform/ocr/mobile_ocr_provider.dart';
import '../../../../platform/translation/mobile_translation_provider.dart';
import '../../../../platform/translation/scan_language_detector.dart';
import '../../../../platform/license/license_failure_text.dart';
import '../../domain/scan_translation_entity_protector.dart';
import '../../domain/scan_translation_integrity.dart';

enum ScanImageSource { camera, gallery }

enum ScanTranslationStatus {
  idle,
  picking,
  imageSelected,
  recognizing,
  recognized,
  translating,
  translated,
  saving,
  saved,
  failed,
}

class PickedScanImage {
  const PickedScanImage({
    required this.path,
    required this.previewBytes,
    this.aspectRatio = 4 / 3,
  });

  final String path;
  final Uint8List previewBytes;
  final double aspectRatio;
}

class ScanTranslatedBlock {
  const ScanTranslatedBlock({required this.source, required this.translation});

  final MobileOcrBlock source;
  final String translation;
}

typedef ScanImagePicker =
    Future<PickedScanImage?> Function(ScanImageSource source);

class ScanTranslationController extends ChangeNotifier {
  ScanTranslationController({
    required MobileOcrProvider ocrProvider,
    required MobileTranslationProvider translationProvider,
    required ScanImagePicker pickImagePath,
    required SessionHistoryRepository historyRepository,
    Future<String?> Function(String)? detectLanguage,
    Future<String> Function()? startAuthorization,
    Future<void> Function(String)? verifyAuthorization,
  }) : _ocrProvider = ocrProvider,
       _translationProvider = translationProvider,
       _pickImagePath = pickImagePath,
       _historyRepository = historyRepository,
       _detectLanguage = detectLanguage ?? ScanLanguageDetector().detect,
       _startAuthorization = startAuthorization,
       _verifyAuthorization = verifyAuthorization;

  final MobileOcrProvider _ocrProvider;
  final MobileTranslationProvider _translationProvider;
  final ScanImagePicker _pickImagePath;
  final SessionHistoryRepository _historyRepository;
  final Future<String?> Function(String) _detectLanguage;
  final Future<String> Function()? _startAuthorization;
  final Future<void> Function(String)? _verifyAuthorization;
  int _generation = 0;
  bool _disposed = false;

  ScanTranslationStatus status = ScanTranslationStatus.idle;
  String imagePath = '';
  Uint8List? imagePreviewBytes;
  double imageAspectRatio = 4 / 3;
  String recognizedText = '';
  String translatedText = '';
  List<MobileOcrBlock> recognizedBlocks = const <MobileOcrBlock>[];
  List<ScanTranslatedBlock> translatedBlocks = const <ScanTranslatedBlock>[];
  String sourceLanguage = 'auto';
  String selectedSourceLanguage = 'auto';
  String targetLanguage = 'en';
  String? message;
  String? savedSessionId;

  bool get isBusy {
    return status == ScanTranslationStatus.picking ||
        status == ScanTranslationStatus.recognizing ||
        status == ScanTranslationStatus.translating ||
        status == ScanTranslationStatus.saving;
  }

  bool get canShare {
    return recognizedText.trim().isNotEmpty || translatedText.trim().isNotEmpty;
  }

  bool _current(int generation) => !_disposed && generation == _generation;

  void setSourceLanguage(String language) {
    if (isBusy ||
        !const {'auto', 'zh', 'en'}.contains(language) ||
        language == selectedSourceLanguage) {
      return;
    }
    selectedSourceLanguage = language;
    sourceLanguage = language;
    translatedText = '';
    translatedBlocks = const <ScanTranslatedBlock>[];
    savedSessionId = null;
    if (recognizedText.isNotEmpty) status = ScanTranslationStatus.recognized;
    message = null;
    notifyListeners();
  }

  void setTargetLanguage(String language) {
    if (isBusy ||
        (language != 'zh' && language != 'en') ||
        language == targetLanguage) {
      return;
    }
    targetLanguage = language;
    translatedText = '';
    translatedBlocks = const <ScanTranslatedBlock>[];
    savedSessionId = null;
    if (recognizedText.isNotEmpty) {
      status = ScanTranslationStatus.recognized;
      message = null;
    }
    notifyListeners();
  }

  Future<void> selectImage(ScanImageSource source) async {
    if (isBusy || _disposed) return;
    final generation = ++_generation;
    final previousStatus = status;
    status = ScanTranslationStatus.picking;
    message = null;
    notifyListeners();

    PickedScanImage? image;
    try {
      image = await _pickImagePath(source);
    } on Object {
      if (!_current(generation)) return;
      status = ScanTranslationStatus.failed;
      message = 'scan_image_pick_failed';
      notifyListeners();
      return;
    }
    if (!_current(generation)) return;
    if (image == null || image.path.trim().isEmpty) {
      status = previousStatus;
      notifyListeners();
      return;
    }

    imagePath = image.path;
    imagePreviewBytes = image.previewBytes;
    imageAspectRatio = image.aspectRatio > 0 ? image.aspectRatio : 4 / 3;
    recognizedText = '';
    translatedText = '';
    recognizedBlocks = const <MobileOcrBlock>[];
    translatedBlocks = const <ScanTranslatedBlock>[];
    savedSessionId = null;
    status = ScanTranslationStatus.imageSelected;
    notifyListeners();
  }

  Future<void> recognizeSelectedImage() async {
    if (isBusy || _disposed) return;
    final generation = ++_generation;
    final path = imagePath.trim();
    if (path.isEmpty) {
      status = ScanTranslationStatus.failed;
      message = 'scan_pick_image_first';
      notifyListeners();
      return;
    }
    status = ScanTranslationStatus.recognizing;
    message = null;
    notifyListeners();

    try {
      final lease = await _startAuthorization?.call();
      if (!_current(generation)) return;
      final result = await _ocrProvider.recognizeImage(
        path,
        preferredScripts: targetLanguage == 'zh'
            ? const <String>['latin', 'chinese']
            : const <String>['chinese', 'latin'],
      );
      if (lease != null) await _verifyAuthorization?.call(lease);
      if (!_current(generation)) return;
      // Do not guess that an OCR currency symbol is a certification mark.
      final nextText = result?.text.trim() ?? '';
      if (nextText.isEmpty) {
        status = ScanTranslationStatus.failed;
        message = 'scan_no_text';
        notifyListeners();
        return;
      }
      recognizedText = nextText;
      recognizedBlocks = List<MobileOcrBlock>.unmodifiable(
        result?.blocks ?? const <MobileOcrBlock>[],
      );
      translatedText = '';
      translatedBlocks = const <ScanTranslatedBlock>[];
      savedSessionId = null;
    } on Object catch (error) {
      if (!_current(generation)) return;
      status = ScanTranslationStatus.failed;
      message = 'scan_ocr_failed';
      message = deviceLicenseFailureText(error) ?? message;
      notifyListeners();
      return;
    }

    status = ScanTranslationStatus.recognized;
    notifyListeners();
  }

  Future<void> translateRecognizedText() async {
    if (isBusy || _disposed) return;
    final generation = ++_generation;
    final text = recognizedText.trim();
    if (text.isEmpty) {
      status = ScanTranslationStatus.failed;
      message = 'scan_no_text';
      notifyListeners();
      return;
    }

    status = ScanTranslationStatus.translating;
    savedSessionId = null;
    message = null;
    notifyListeners();

    try {
      final lease = await _startAuthorization?.call();
      if (!_current(generation)) return;
      final standalone = ScanTranslationEntityProtector(
        text,
      ).canBypassTranslation;
      final detected = selectedSourceLanguage == 'auto'
          ? (standalone ? 'auto' : await _detectLanguage(text))
          : selectedSourceLanguage;
      if (!_current(generation)) return;
      if (detected == null) {
        status = ScanTranslationStatus.recognized;
        message = 'scan_language_uncertain';
        notifyListeners();
        return;
      }
      sourceLanguage = detected;
      String nextText;
      List<ScanTranslatedBlock> nextBlocks;
      if (recognizedBlocks.isEmpty) {
        nextText = await _translateText(text, sourceLanguage);
        nextBlocks = const <ScanTranslatedBlock>[];
      } else {
        final blocks = <ScanTranslatedBlock>[];
        for (final block in recognizedBlocks) {
          final standaloneBlock = ScanTranslationEntityProtector(
            block.text,
          ).canBypassTranslation;
          final blockLanguage = selectedSourceLanguage != 'auto'
              ? selectedSourceLanguage
              : standaloneBlock
              ? 'auto'
              : recognizedBlocks.length == 1
              ? detected
              : await _detectLanguage(block.text);
          if (!_current(generation)) return;
          if (blockLanguage == null) throw const _ScanLanguageUncertain();
          final translation = await _translateText(block.text, blockLanguage);
          if (!_current(generation)) return;
          if (translation.isEmpty) throw StateError('scan_block_untranslated');
          blocks.add(
            ScanTranslatedBlock(source: block, translation: translation),
          );
        }
        nextBlocks = List<ScanTranslatedBlock>.unmodifiable(blocks);
        nextText = blocks.map((block) => block.translation).join('\n');
      }
      if (lease != null) await _verifyAuthorization?.call(lease);
      if (!_current(generation)) return;
      translatedText = nextText;
      translatedBlocks = nextBlocks;
    } on Object catch (error) {
      if (!_current(generation)) return;
      status = ScanTranslationStatus.recognized;
      message = error is _ScanLanguageUncertain
          ? 'scan_language_uncertain'
          : error is ScanEntityRestorationFailure
          ? 'scan_entities_unverified'
          : 'scan_translation_unavailable';
      message = deviceLicenseFailureText(error) ?? message;
      notifyListeners();
      return;
    }
    if (translatedText.isEmpty) {
      status = ScanTranslationStatus.recognized;
      message = 'scan_translation_unavailable';
    } else {
      status = ScanTranslationStatus.translated;
    }
    notifyListeners();
  }

  Future<String> _translateText(String text, String detectedLanguage) async {
    final entityProtector = ScanTranslationEntityProtector(text);
    if (entityProtector.canBypassTranslation) return text;
    if (detectedLanguage == targetLanguage) return text;
    final result = await _translationProvider.translate(
      entityProtector.translationInput,
      MobileTranslationConfig(
        sourceLanguage: detectedLanguage,
        targetLanguage: targetLanguage,
      ),
    );
    final translation = result?.text.trim() ?? '';
    if (translation.isEmpty) return '';
    final restored = entityProtector.restore(translation);
    if (!scanTranslationIntegrity(
      text,
      restored,
      sourceLanguage: detectedLanguage,
      targetLanguage: targetLanguage,
    )) {
      throw const ScanEntityRestorationFailure();
    }
    return restored;
  }

  Future<void> save() async {
    if (isBusy || _disposed) return;
    final generation = ++_generation;
    if (recognizedText.trim().isEmpty) {
      status = ScanTranslationStatus.failed;
      message = 'scan_no_text';
      notifyListeners();
      return;
    }

    status = ScanTranslationStatus.saving;
    message = null;
    notifyListeners();
    try {
      final detail = await _historyRepository.saveTextTranslationSession(
        sourceText: recognizedText,
        translatedText: translatedText,
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage,
        sourceKind: 'scan',
      );
      if (!_current(generation)) return;
      savedSessionId = detail.sessionId;
      status = ScanTranslationStatus.saved;
      message = 'scan_saved';
      notifyListeners();
    } on Object {
      if (!_current(generation)) return;
      status = ScanTranslationStatus.failed;
      message = 'scan_save_failed';
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _ocrProvider.dispose();
    _translationProvider.dispose();
    super.dispose();
  }
}

class _ScanLanguageUncertain implements Exception {
  const _ScanLanguageUncertain();
}
