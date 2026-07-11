import 'package:flutter/foundation.dart';

import '../../../history/data/session_history_repository.dart';
import '../../../../platform/speech/speech_output_provider.dart';
import '../../../../platform/speech/speech_text_normalizer.dart';
import '../../../../platform/translation/mobile_translation_provider.dart';
import '../../../../platform/translation/text_language_detector.dart';

enum TypeToSpeakStatus {
  idle,
  translating,
  translated,
  speaking,
  saving,
  saved,
  failed,
}

class TypeToSpeakController extends ChangeNotifier {
  TypeToSpeakController({
    required MobileTranslationProvider translationProvider,
    required SpeechOutputProvider speechOutputProvider,
    required SessionHistoryRepository historyRepository,
  })  : _translationProvider = translationProvider,
        _speechOutputProvider = speechOutputProvider,
        _historyRepository = historyRepository;

  final MobileTranslationProvider _translationProvider;
  final SpeechOutputProvider _speechOutputProvider;
  final SessionHistoryRepository _historyRepository;

  TypeToSpeakStatus status = TypeToSpeakStatus.idle;
  String sourceText = '';
  String translatedText = '';
  String sourceLanguage = 'auto';
  String targetLanguage = 'zh';
  String? message;
  String? savedSessionId;

  Future<void> translate(String text) async {
    final trimmed = text.trim();
    sourceText = trimmed;
    translatedText = '';
    savedSessionId = null;
    message = null;
    if (trimmed.isEmpty) {
      status = TypeToSpeakStatus.failed;
      message = 'type_to_speak_empty';
      notifyListeners();
      return;
    }

    final detectedLanguage = detectTextLanguage(trimmed);
    sourceLanguage = detectedLanguage;
    targetLanguage = detectedLanguage == 'zh' ? 'en' : 'zh';
    status = TypeToSpeakStatus.translating;
    notifyListeners();

    final result = await _translationProvider.translate(
      trimmed,
      MobileTranslationConfig(
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage,
      ),
    );
    if (result == null || result.text.trim().isEmpty) {
      status = TypeToSpeakStatus.failed;
      message = 'type_to_speak_translation_unavailable';
      notifyListeners();
      return;
    }

    translatedText = result.text.trim();
    status = TypeToSpeakStatus.translated;
    notifyListeners();
  }

  Future<void> save() async {
    if (sourceText.trim().isEmpty || translatedText.trim().isEmpty) {
      status = TypeToSpeakStatus.failed;
      message = 'type_to_speak_translation_unavailable';
      notifyListeners();
      return;
    }

    status = TypeToSpeakStatus.saving;
    message = null;
    notifyListeners();
    try {
      final detail = await _historyRepository.saveTypeToSpeakSession(
        sourceText: sourceText,
        translatedText: translatedText,
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage,
      );
      savedSessionId = detail.sessionId;
      status = TypeToSpeakStatus.saved;
      message = 'type_to_speak_saved';
      notifyListeners();
    } on Object {
      status = TypeToSpeakStatus.failed;
      message = 'type_to_speak_save_failed';
      notifyListeners();
    }
  }

  Future<void> speak() async {
    if (translatedText.trim().isEmpty) {
      status = TypeToSpeakStatus.failed;
      message = 'type_to_speak_translation_unavailable';
      notifyListeners();
      return;
    }
    try {
      await _speechOutputProvider.speak(
        text: normalizeSpeechOutputText(translatedText, targetLanguage),
        language: targetLanguage,
      );
      status = TypeToSpeakStatus.speaking;
      message = null;
      notifyListeners();
    } on Object {
      status = TypeToSpeakStatus.failed;
      message = 'type_to_speak_speech_unavailable';
      notifyListeners();
    }
  }

  Future<void> stopSpeaking() async {
    await _speechOutputProvider.stop();
    status = translatedText.isEmpty
        ? TypeToSpeakStatus.idle
        : TypeToSpeakStatus.translated;
    notifyListeners();
  }
}
