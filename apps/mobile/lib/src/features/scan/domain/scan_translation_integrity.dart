/// A conservative check, not proof of semantic correctness. Real quality
/// qualification is still required; uncertain output is held for review.
bool scanTranslationIntegrity(
  String source,
  String translated, {
  required String sourceLanguage,
  required String targetLanguage,
}) {
  List<String> numbers(String value) => RegExp(
    r'\d+(?:[,.]\d+)*',
  ).allMatches(value).map((m) => m.group(0)!).toList()..sort();
  final before = numbers(source), after = numbers(translated);
  if (before.length != after.length) return false;
  for (var i = 0; i < before.length; i++) {
    if (before[i] != after[i]) return false;
  }
  bool negative(String value, String language) {
    if (language == 'zh') return RegExp(r'[不没無无未非别勿]').hasMatch(value);
    if (language == 'en') {
      return RegExp(
        r"\b(?:no|not|never|without|cannot|neither|nor|[a-z]+n't)\b",
        caseSensitive: false,
      ).hasMatch(value);
    }
    return false;
  }

  return negative(source, sourceLanguage) ==
      negative(translated, targetLanguage);
}
