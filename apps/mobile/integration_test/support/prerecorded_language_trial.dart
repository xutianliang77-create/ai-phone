import 'dart:convert';
import 'package:translation_mobile/src/platform/translation/translation_language_pair.dart';

/// Embedded QA protocol only. Reference text is never passed to a provider.
class PrerecordedLanguageTrial {
  PrerecordedLanguageTrial(Map<String, dynamic> json)
      : id = json['id'] as String,
        name = json['name'] as String,
        sha256 = json['sha256'] as String,
        source = json['source'] as String,
        target = json['target'] as String,
        observeOnly = json['kind'] == 'asr_observation' {
    if (!RegExp(r'^[A-Za-z0-9_-]{1,80}$').hasMatch(id) ||
        !RegExp(r'^[A-Za-z0-9_-]{1,80}$').hasMatch(name) ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(sha256) ||
        canonicalTranslationLanguageCode(source) != source ||
        canonicalTranslationLanguageCode(target) != target ||
        source == target ||
        !['journey', 'asr_observation'].contains(json['kind']) ||
        json.keys.any((key) => ![
              'id',
              'name',
              'sha256',
              'source',
              'target',
              'kind'
            ].contains(key))) {
      throw FormatException('Invalid fixed-language QA trial');
    }
  }
  final String id, name, sha256, source, target;
  final bool observeOnly;
  static List<PrerecordedLanguageTrial> parse(String encoded) {
    final value = jsonDecode(encoded);
    if (value is! List || value.isEmpty || value.length > 24)
      throw const FormatException('Expected 1 to 24 trials');
    final trials = value
        .map((v) =>
            PrerecordedLanguageTrial(Map<String, dynamic>.from(v as Map)))
        .toList();
    if (trials.map((t) => t.id).toSet().length != trials.length)
      throw const FormatException('Duplicate trial ID');
    return trials;
  }
}
