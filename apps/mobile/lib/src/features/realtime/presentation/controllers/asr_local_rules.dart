import 'asr_local_rule_data.dart';
import 'asr_local_domain_terms.dart';

class LocalAsrRuleResult {
  const LocalAsrRuleResult(
      this.text, this.operations, this.protectedTermsKept, this.warnings);
  final String text;
  final List<String> operations, protectedTermsKept, warnings;
  Map<String, Object?> toJson() => {
        'text': text,
        'operations': operations,
        'protectedTermsKept': protectedTermsKept,
        'warnings': warnings,
      };
}

/// Algorithm-equivalent port of frozen packages/llm/src/local-rules.ts.
/// The default retains legacy behavior for parity tests and explicit consumers.
LocalAsrRuleResult applyAsrLocalRules(String rawText,
    {List<String>? protectedTerms, bool legacyUnscopedDomainRules = true}) {
  final terms = protectedTerms ?? defaultAsrProtectedTerms;
  var text = rawText;
  final operations = <String>[];
  for (final rule in asrSilenceRules) {
    text = _replace(text, rule.$1, rule.$2, rule.$3);
  }
  text = text.trim();
  final lowerTerms = terms.map((t) => t.toLowerCase()).toSet();
  for (final rule in asrTermRules) {
    if (!rule.$5.every((t) => lowerTerms.contains(t.toLowerCase()))) continue;
    if (!legacyUnscopedDomainRules &&
        rule.$5.isEmpty &&
        rule.$4 == 'domain_phrase_correction') {
      continue;
    }
    final next = _replace(text, rule.$1, rule.$2, rule.$3);
    if (next != text) {
      text = next;
      operations.add(rule.$4);
    }
  }
  final beforeCleanup = text;
  for (final rule in asrDisfluencyRules) {
    text = _replace(text, rule.$1, rule.$2, rule.$3);
  }
  text = text.trim();
  if (text != beforeCleanup) operations.add('disfluency_cleanup');
  text = text.replaceAll(RegExp(r'\s+'), ' ').trim();
  return LocalAsrRuleResult(
      text,
      operations.toSet().toList(),
      terms
          .where((t) =>
              t.isNotEmpty && text.toLowerCase().contains(t.toLowerCase()))
          .toList(),
      const []);
}

/// Only the selected visible phone lexicon is active. Do not introduce hidden
/// cultivation phrases or apply English filler rules to other languages.
LocalAsrRuleResult refinePhoneAsrText(String text,
    {required String? language, required String domainPack}) {
  if (!['zh', 'en'].contains(language)) {
    return LocalAsrRuleResult(text, const [], const [], const []);
  }
  final result = applyAsrLocalRules(text,
      protectedTerms: asrDomainProtectedTerms[domainPack] ?? const [],
      legacyUnscopedDomainRules: false);
  if (result.text.isEmpty) {
    return LocalAsrRuleResult(
        text, const [], const [], const ['empty_optimized_text_kept_raw']);
  }
  return result;
}

String _replace(
        String text, String pattern, String replacement, bool insensitive) =>
    text.replaceAllMapped(
        RegExp(pattern, caseSensitive: !insensitive),
        (match) => replacement.replaceAllMapped(RegExp(r'\$([1-9]\d*)'),
            (group) => match.group(int.parse(group.group(1)!)) ?? ''));
