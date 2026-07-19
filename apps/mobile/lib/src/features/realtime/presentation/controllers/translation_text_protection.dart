import '../../../../platform/translation/mobile_translation_provider.dart';

class TranslationTextProtection {
  const TranslationTextProtection({
    required this.text,
    required List<String> protectedText,
  }) : _protectedText = protectedText;

  final String text;
  final List<String> _protectedText;

  bool get hasProtectedText => _protectedText.isNotEmpty;

  String? restore(String translatedText) {
    var restored = translatedText;
    for (var index = 0; index < _protectedText.length; index++) {
      final marker = _markerPattern(index);
      if (!marker.hasMatch(restored)) return null;
      restored = restored.replaceAll(marker, _protectedText[index]);
    }
    return restored;
  }
}

TranslationTextProtection protectTranslationText(
  String text,
  MobileTranslationConfig config,
) {
  final targetScript = _targetScriptPattern(config.targetLanguage);
  final alternatives = <String>[
    _protectedLiteralPattern,
    if (targetScript != null) targetScript,
  ];
  final protectedText = <String>[];
  final pattern = RegExp(alternatives.join('|'));
  final protected = text.replaceAllMapped(pattern, (match) {
    final value = match.group(0)!;
    final marker = _marker(protectedText.length);
    protectedText.add(value);
    return marker;
  });
  return TranslationTextProtection(
    text: protected,
    protectedText: protectedText,
  );
}

const _protectedLiteralPattern = r'(?:'
    r'[A-Za-z]{1,16}(?:[-_][A-Za-z0-9]+)*\d[A-Za-z0-9_-]*'
    r'|[A-Z]{2,}(?:[-_][A-Z0-9]+)*'
    r'|[¥￥$＄]\s*\d+(?:[.,]\d+)*(?:\s*[%％])?'
    r'|\+?\d(?:[\d ()-]{5,}\d)'
    r'|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}'
    r'|\d{1,2}:\d{2}(?::\d{2})?'
    r'|\d+(?:[.,]\d+)*(?:\s*[%％])?'
    r')';

String? _targetScriptPattern(String language) {
  final normalized = language.trim().toLowerCase();
  if (normalized == 'en' || normalized.startsWith('en-')) {
    return r"[A-Za-z]+(?:[-'’][A-Za-z]+)*";
  }
  if (normalized == 'zh' || normalized.startsWith('zh-')) {
    return r'[\u3400-\u9fff]+';
  }
  return null;
}

String _marker(int index) => 'XTLKEEP${index}QXZ';

RegExp _markerPattern(int index) {
  final characters = _marker(index).split('');
  return RegExp(
    characters.map(RegExp.escape).join(r'\s*'),
    caseSensitive: false,
  );
}
