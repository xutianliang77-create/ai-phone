import 'package:flutter/foundation.dart';

import '../../../history/data/session_history_repository.dart';
import '../../../../platform/ocr/mobile_ocr_provider.dart';
import '../../../../platform/translation/mobile_translation_provider.dart';
import '../../../../platform/translation/text_language_detector.dart';
import '../../domain/scan_translation_entity_protector.dart';

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

typedef ScanImagePicker = Future<PickedScanImage?> Function(
  ScanImageSource source,
);

class ScanTranslationController extends ChangeNotifier {
  ScanTranslationController({
    required MobileOcrProvider ocrProvider,
    required MobileTranslationProvider translationProvider,
    required ScanImagePicker pickImagePath,
    required SessionHistoryRepository historyRepository,
  })  : _ocrProvider = ocrProvider,
        _translationProvider = translationProvider,
        _pickImagePath = pickImagePath,
        _historyRepository = historyRepository;

  final MobileOcrProvider _ocrProvider;
  final MobileTranslationProvider _translationProvider;
  final ScanImagePicker _pickImagePath;
  final SessionHistoryRepository _historyRepository;

  ScanTranslationStatus status = ScanTranslationStatus.idle;
  String imagePath = '';
  Uint8List? imagePreviewBytes;
  double imageAspectRatio = 4 / 3;
  String recognizedText = '';
  String translatedText = '';
  List<MobileOcrBlock> recognizedBlocks = const <MobileOcrBlock>[];
  List<ScanTranslatedBlock> translatedBlocks = const <ScanTranslatedBlock>[];
  String sourceLanguage = 'auto';
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
    status = ScanTranslationStatus.picking;
    message = null;
    notifyListeners();

    PickedScanImage? image;
    try {
      image = await _pickImagePath(source);
    } on Object {
      status = ScanTranslationStatus.failed;
      message = 'scan_image_pick_failed';
      notifyListeners();
      return;
    }
    if (image == null || image.path.trim().isEmpty) {
      status = ScanTranslationStatus.idle;
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
      final result = await _ocrProvider.recognizeImage(path);
      recognizedText = normalizeScanTranslationEntities(
        result?.text.trim() ?? '',
      );
      recognizedBlocks = (result?.blocks ?? const <MobileOcrBlock>[])
          .map(_normalizeOcrBlock)
          .toList(growable: false);
    } on Object {
      status = ScanTranslationStatus.failed;
      message = 'scan_ocr_failed';
      notifyListeners();
      return;
    }

    if (recognizedText.isEmpty) {
      status = ScanTranslationStatus.failed;
      message = 'scan_no_text';
      notifyListeners();
      return;
    }

    status = ScanTranslationStatus.recognized;
    notifyListeners();
  }

  MobileOcrBlock _normalizeOcrBlock(MobileOcrBlock block) {
    return MobileOcrBlock(
      text: normalizeScanTranslationEntities(block.text),
      left: block.left,
      top: block.top,
      width: block.width,
      height: block.height,
    );
  }

  Future<void> translateRecognizedText() async {
    final text = recognizedText.trim();
    if (text.isEmpty) {
      status = ScanTranslationStatus.failed;
      message = 'scan_no_text';
      notifyListeners();
      return;
    }

    sourceLanguage = detectTextLanguage(text);
    status = ScanTranslationStatus.translating;
    savedSessionId = null;
    message = null;
    notifyListeners();

    try {
      if (recognizedBlocks.isEmpty) {
        translatedText = await _translateText(text, sourceLanguage);
        translatedBlocks = const <ScanTranslatedBlock>[];
      } else {
        final blocks = <ScanTranslatedBlock>[];
        for (final block in recognizedBlocks) {
          final blockLanguage = detectTextLanguage(block.text);
          final translation = await _translateText(block.text, blockLanguage);
          if (translation.isNotEmpty) {
            blocks.add(ScanTranslatedBlock(
              source: block,
              translation: translation,
            ));
          }
        }
        translatedBlocks = List<ScanTranslatedBlock>.unmodifiable(blocks);
        translatedText = blocks.map((block) => block.translation).join('\n');
      }
    } on Object {
      status = ScanTranslationStatus.recognized;
      message = 'scan_translation_unavailable';
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
    if (detectedLanguage == targetLanguage) return text;
    final entityProtector = ScanTranslationEntityProtector(text);
    if (entityProtector.canBypassTranslation) return text;
    final result = await _translationProvider.translate(
      entityProtector.translationInput,
      MobileTranslationConfig(
        sourceLanguage: detectedLanguage,
        targetLanguage: targetLanguage,
      ),
    );
    final translation = result?.text.trim() ?? '';
    return translation.isEmpty ? '' : entityProtector.restore(translation);
  }

  Future<void> save() async {
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
      savedSessionId = detail.sessionId;
      status = ScanTranslationStatus.saved;
      message = 'scan_saved';
      notifyListeners();
    } on Object {
      status = ScanTranslationStatus.failed;
      message = 'scan_save_failed';
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _ocrProvider.dispose();
    _translationProvider.dispose();
    super.dispose();
  }
}
