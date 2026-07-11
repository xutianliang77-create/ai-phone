class SubtitleSegment {
  const SubtitleSegment({
    required this.id,
    required this.sourceText,
    required this.translatedText,
    this.rawText,
    this.optimizedText,
    this.sourceLanguage,
    this.targetLanguage,
    this.confidence,
    this.stage,
    this.provider,
    this.model,
    this.latencyMs,
    this.refinement,
  });

  final String id;
  final String sourceText;
  final String translatedText;
  final String? rawText;
  final String? optimizedText;
  final String? sourceLanguage;
  final String? targetLanguage;
  final double? confidence;
  final String? stage;
  final String? provider;
  final String? model;
  final int? latencyMs;
  final Map<String, Object?>? refinement;
}
