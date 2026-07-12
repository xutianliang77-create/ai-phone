class TurnLanguageProfile {
  const TurnLanguageProfile({
    required this.dominantLanguage,
    required this.detectedLanguages,
    required this.mixedLanguage,
  });

  final String dominantLanguage;
  final List<String> detectedLanguages;
  final bool mixedLanguage;

  static TurnLanguageProfile? fromJson(Map<String, Object?> json) {
    final dominantLanguage = json['dominantLanguage'] as String?;
    final detected = json['detectedLanguages'];
    if (dominantLanguage == null && detected is! List) return null;
    final detectedLanguages = detected is List
        ? detected.whereType<String>().toList(growable: false)
        : <String>[];
    return TurnLanguageProfile(
      dominantLanguage: dominantLanguage ??
          (detectedLanguages.isEmpty ? 'unknown' : detectedLanguages.first),
      detectedLanguages: detectedLanguages,
      mixedLanguage:
          json['mixedLanguage'] as bool? ?? detectedLanguages.length > 1,
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'dominantLanguage': dominantLanguage,
        'detectedLanguages': detectedLanguages,
        'mixedLanguage': mixedLanguage,
      };
}
