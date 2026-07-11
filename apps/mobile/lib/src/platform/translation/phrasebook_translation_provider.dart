import 'mobile_translation_provider.dart';

class PhrasebookTranslationProvider
    implements MobileTranslationProvider, MobileTranslationDiagnostics {
  static const _enToZh = <String, String>{
    'hello': '你好',
    'hello, this is a realtime translation test': '你好，这是一次实时翻译测试。',
    'this is a realtime translation test': '这是一次实时翻译测试。',
  };

  static const _zhToEn = <String, String>{
    '你好': 'Hello',
    '你好，这是一次实时翻译测试。': 'Hello, this is a realtime translation test.',
    '你好，这是一次实时翻译测试': 'Hello, this is a realtime translation test.',
    '这是一次实时翻译测试。': 'This is a realtime translation test.',
    '这是一次实时翻译测试': 'This is a realtime translation test.',
  };

  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    final sourceText = text.trim();
    if (sourceText.isEmpty) return null;
    final translatedText = _lookup(sourceText, config.targetLanguage);
    if (translatedText == null) return null;
    return MobileTranslationResult(
      text: translatedText,
      provider: 'phrasebook',
    );
  }

  @override
  Future<void> dispose() async {}

  @override
  Future<MobileTranslationAvailability> availability(
    MobileTranslationConfig config,
  ) async {
    return MobileTranslationAvailability(
      available: true,
      provider: 'phrasebook',
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
      status: 'ready',
      reason: 'ready',
    );
  }

  String? _lookup(String text, String targetLanguage) {
    if (targetLanguage == 'en') return _zhToEn[_normalizeZh(text)];
    return _enToZh[_normalizeEn(text)];
  }

  String _normalizeEn(String text) {
    return text.trim().toLowerCase().replaceAll(RegExp(r'[.!?]+$'), '');
  }

  String _normalizeZh(String text) {
    final trimmed = text.trim();
    if (_zhToEn.containsKey(trimmed)) return trimmed;
    return trimmed.replaceAll(RegExp(r'[。！？]+$'), '');
  }
}
