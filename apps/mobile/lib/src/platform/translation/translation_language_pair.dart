import 'supported_translation_language.dart';

/// Strict bridge comparison; unsupported/unknown values never become zh/en.
String? canonicalTranslationLanguageCode(String? raw) {
  if (raw == null) return null;
  final value = raw.trim().replaceAll('_', '-').toLowerCase();
  if (!RegExp(r'^[a-z]{2,3}(-[a-z0-9]{2,8})*$').hasMatch(value)) return null;
  final parts = value.split('-');
  var code = parts.first;
  if (code == 'zh' || code == 'cmn') {
    code = parts.contains('hant')
        ? 'zh-Hant'
        : parts.contains('hans')
            ? 'zh'
            : parts.any((part) => const ['tw', 'hk', 'mo'].contains(part))
                ? 'zh-Hant'
                : 'zh';
  }
  return isSupportedHyMtLanguageCode(code) ? code : null;
}

bool translationLanguagesMatch(String? actual, String requested) {
  final expected = canonicalTranslationLanguageCode(requested);
  return expected != null &&
      canonicalTranslationLanguageCode(actual) == expected;
}

/// The last explicitly selected pair, not a detected language or a new mode.
class TranslationLanguagePair {
  const TranslationLanguagePair(this.source, this.target);
  final String source;
  final String target;

  static TranslationLanguagePair? fromLanguages(String source, String target) {
    if (!isSupportedHyMtLanguageCode(source) ||
        !isSupportedHyMtLanguageCode(target) ||
        source == target) {
      return null;
    }
    return TranslationLanguagePair(source, target);
  }

  static TranslationLanguagePair? fromJson(Object? value) {
    if (value is! Map ||
        value['source'] is! String ||
        value['target'] is! String) {
      return null;
    }
    return fromLanguages(value['source'] as String, value['target'] as String);
  }

  String? opposite(String language) {
    if (language == source) return target;
    if (language == target) return source;
    return null;
  }

  Map<String, String> toJson() => {'source': source, 'target': target};
}
