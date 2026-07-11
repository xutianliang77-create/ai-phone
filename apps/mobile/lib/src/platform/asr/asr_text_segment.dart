class AsrTextSegment {
  const AsrTextSegment({
    required this.id,
    required this.text,
    required this.language,
    this.isFinal = true,
    this.confidence,
  });

  final String id;
  final String text;
  final String language;
  final bool isFinal;
  final double? confidence;

  factory AsrTextSegment.fromJson(Map<String, Object?> json) {
    final segment = AsrTextSegment.tryFromJson(json);
    if (segment == null) {
      throw const FormatException('Invalid ASR text segment payload');
    }
    return segment;
  }

  static AsrTextSegment? tryFromJson(Map<String, Object?> json) {
    final text = json['text'];
    if (text is! String || text.trim().isEmpty) return null;
    final id = json['id'];
    final language = json['language'];
    return AsrTextSegment(
      id: id is String && id.trim().isNotEmpty
          ? id
          : 'asr_${text.hashCode.abs()}',
      text: text,
      language: language is String && language.trim().isNotEmpty
          ? language
          : 'auto',
      isFinal: _boolValue(json['isFinal']) ?? true,
      confidence: (json['confidence'] as num?)?.toDouble(),
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
  final language = rawLanguage.trim().toLowerCase();
  if (language == 'zh' ||
      language.startsWith('zh-') ||
      language == 'cmn' ||
      language.startsWith('cmn-')) {
    return 'zh';
  }
  if (language == 'en' || language.startsWith('en-')) {
    return 'en';
  }
  return fallbackTargetLanguage == 'en' ? 'zh' : 'en';
}
