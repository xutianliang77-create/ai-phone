import '../translation/translation_language_pair.dart';

/// Missing metadata preserves the 1.0 provider contract, not LID qualification.
enum AsrLanguageEvidence {
  legacy,
  userSelected,
  detected,
  textInferred,
  mixed,
  unknown,
}

class AsrTextSegment {
  const AsrTextSegment({
    required this.id,
    required this.text,
    required this.language,
    this.isFinal = true,
    this.confidence,
    this.languageEvidence = AsrLanguageEvidence.legacy,
    this.captureId,
    this.languagePolicyKey,
    this.revision,
    this.isRetraction = false,
  });

  final String id;
  final String text;
  final String language;
  final bool isFinal;
  final double? confidence;
  final AsrLanguageEvidence languageEvidence;
  final String? captureId;
  final String? languagePolicyKey;
  final int? revision;
  final bool isRetraction;

  AsrTextSegment copyWith({String? text, String? language, bool? isFinal}) =>
      AsrTextSegment(
        id: id,
        text: text ?? this.text,
        language: language ?? this.language,
        isFinal: isFinal ?? this.isFinal,
        confidence: confidence,
        languageEvidence: languageEvidence,
        captureId: captureId,
        languagePolicyKey: languagePolicyKey,
        revision: revision,
        isRetraction: isRetraction,
      );

  factory AsrTextSegment.fromJson(Map<String, Object?> json) {
    final segment = AsrTextSegment.tryFromJson(json);
    if (segment == null) {
      throw const FormatException('Invalid ASR text segment payload');
    }
    return segment;
  }

  static AsrTextSegment? tryFromJson(Map<String, Object?> json) {
    final text = json['text'];
    final retracted = json['isRetraction'] == true;
    if (text is! String || (!retracted && text.trim().isEmpty)) return null;
    final id = json['id'];
    final language = json['language'];
    final hasVersion =
        ['captureId', 'languagePolicyKey', 'revision'].any(json.containsKey);
    if (retracted && (!hasVersion || id is! String || id.trim().isEmpty ||
        text.isNotEmpty || _boolValue(json['isFinal']) != false)) {
      return null;
    }
    if (hasVersion &&
        (json['captureId'] is! String ||
            (json['captureId'] as String).isEmpty ||
            json['languagePolicyKey'] is! String ||
            (json['languagePolicyKey'] as String).isEmpty ||
            json['revision'] is! int ||
            (json['revision'] as int) < 0)) {
      return null;
    }
    return AsrTextSegment(
      id: id is String && id.trim().isNotEmpty
          ? id
          : 'asr_${text.hashCode.abs()}',
      text: text,
      language:
          language is String && language.trim().isNotEmpty ? language : 'auto',
      isFinal: _boolValue(json['isFinal']) ?? true,
      confidence: (json['confidence'] as num?)?.toDouble(),
      captureId: json['captureId'] as String?,
      languagePolicyKey: json['languagePolicyKey'] as String?,
      revision: json['revision'] as int?,
      isRetraction: retracted,
      languageEvidence: !json.containsKey('languageEvidence')
          ? (hasVersion
              ? AsrLanguageEvidence.unknown
              : AsrLanguageEvidence.legacy)
          : switch (json['languageEvidence']) {
              'user_selected' => AsrLanguageEvidence.userSelected,
              'detected' => AsrLanguageEvidence.detected,
              'text_inferred' => AsrLanguageEvidence.textInferred,
              'mixed' => AsrLanguageEvidence.mixed,
              _ => AsrLanguageEvidence.unknown,
            },
    );
  }
}

bool? _boolValue(Object? value) {
  if (value is bool) return value;
  if (value is String) {
    final normalized = value.toLowerCase();
    if (normalized == 'true') return true;
    if (normalized == 'false') return false;
  }
  return null;
}

String normalizeAsrLanguageForGateway(
  String rawLanguage, {
  String fallbackTargetLanguage = 'zh',
}) {
  // The opposite-language default belongs only to the legacy wire contract.
  return normalizeAsrLanguage(rawLanguage) ??
      (fallbackTargetLanguage == 'en' ? 'zh' : 'en');
}

String? normalizeAsrLanguage(String rawLanguage) {
  return canonicalTranslationLanguageCode(rawLanguage);
}
