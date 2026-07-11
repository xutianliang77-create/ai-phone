import 'package:flutter/foundation.dart';

import '../../../history/data/session_history_repository.dart';
import '../../../../platform/ocr/mobile_ocr_provider.dart';
import '../../../../platform/translation/mobile_translation_provider.dart';
import '../../../../platform/translation/text_language_detector.dart';

enum ScanImageSource { camera, gallery }

enum ScanTranslationStatus {
  idle,
  picking,
  recognizing,
  recognized,
  translating,
  translated,
  saving,
  saved,
  failed,
}

typedef ScanImagePicker = Future<String?> Function(ScanImageSource source);

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
  String recognizedText = '';
  String translatedText = '';
  String sourceLanguage = 'auto';
  String targetLanguage = 'zh';
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

  Future<void> scan(ScanImageSource source) async {
    status = ScanTranslationStatus.picking;
    message = null;
    notifyListeners();

    final path = await _pickImagePath(source);
    if (path == null || path.trim().isEmpty) {
      status = ScanTranslationStatus.idle;
      notifyListeners();
      return;
    }

    imagePath = path;
    recognizedText = '';
    translatedText = '';
    savedSessionId = null;
    status = ScanTranslationStatus.recognizing;
    notifyListeners();

    try {
      final result = await _ocrProvider.recognizeImage(path);
      recognizedText = result?.text.trim() ?? '';
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
    await translateRecognizedText();
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
    targetLanguage = sourceLanguage == 'zh' ? 'en' : 'zh';
    status = ScanTranslationStatus.translating;
    savedSessionId = null;
    message = null;
    notifyListeners();

    final result = await _translationProvider.translate(
      text,
      MobileTranslationConfig(
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage,
      ),
    );

    translatedText = result?.text.trim() ?? '';
    if (translatedText.isEmpty) {
      status = ScanTranslationStatus.recognized;
      message = 'scan_translation_unavailable';
    } else {
      status = ScanTranslationStatus.translated;
    }
    notifyListeners();
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
