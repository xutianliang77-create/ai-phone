import '../../../../platform/translation/translation_language_pair.dart';

/// Preserve the inherited Chinese/English fallback in either pair order;
/// other pairs use their explicitly selected first language.
String publicAutomaticTarget(String source, String target, bool reverse,
    (String, String)? pair) {
  if (!reverse || pair == null) return target;
  if (source == pair.$1) return pair.$2;
  if (source == pair.$2) return pair.$1;
  bool chinese(String code) => const ['zh', 'zh-Hant', 'yue'].contains(code);
  if (chinese(pair.$1) != chinese(pair.$2) && chinese(source)) {
    return chinese(pair.$1) ? pair.$2 : pair.$1;
  }
  final chineseSide = chinese(pair.$1) ? pair.$1 : chinese(pair.$2) ? pair.$2 : null;
  return [pair.$1, pair.$2].contains('en') && chineseSide != null ? chineseSide : pair.$1;
}

/// null: older server, preserve its old bounded request. A non-null list is
/// derived from BOTH the adapter and server-returned qualified output routes;
/// the phone cannot mint a grant for an arbitrary third language.
List<String>? publicAutomaticSources(Map<String, Object?> offer,
    {required String target, required bool reverse, required (String, String)? pair}) {
  final raw = offer['automaticSourceLanguages'];
  if (raw == null) return null;
  if (raw is! List || raw.length > 64 || raw.toSet().length != raw.length ||
      raw.any((s) => s is! String || canonicalTranslationLanguageCode(s) != s)) {
    throw const FormatException('Invalid automatic source capability');
  }
  final capability = offer['capability'];
  if (capability is! Map || capability['qualifiedLanguagePairs'] is! List) return const [];
  final routes = capability['qualifiedLanguagePairs'] as List;
  bool has(String source, String output) => routes.any((r) => r is Map && r['source'] == source && r['target'] == output);
  if (reverse && (pair == null || ![pair.$1, pair.$2].every(raw.contains) ||
      !has(pair.$1, pair.$2) || !has(pair.$2, pair.$1))) { return const []; }
  final sources = raw.cast<String>().where((source) {
    final output = publicAutomaticTarget(source, target, reverse, pair);
    return source == output || has(source, output);
  }).toList(growable: false);
  return sources.any((s) => s != publicAutomaticTarget(s, target, reverse, pair)) ? sources : const [];
}
