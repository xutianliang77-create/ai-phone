import 'translation_language_pair.dart';

class MobileTranslationConfig {
  const MobileTranslationConfig({
    required this.sourceLanguage,
    required this.targetLanguage,
  });

  final String sourceLanguage;
  final String targetLanguage;
}

class MobileTranslationResult {
  const MobileTranslationResult({
    required this.text,
    required this.provider,
  });

  final String text;
  final String provider;
}

class MobileTranslationAvailability {
  const MobileTranslationAvailability({
    required this.available,
    required this.provider,
    required this.sourceLanguage,
    required this.targetLanguage,
    required this.status,
    required this.reason,
    this.message,
    this.details = const <String, Object?>{},
  });

  final bool available;
  final String provider;
  final String sourceLanguage;
  final String targetLanguage;
  final String status;
  final String reason;
  final String? message;
  final Map<String, Object?> details;

  bool matchesLanguagePair(MobileTranslationConfig config) =>
      translationLanguagesMatch(sourceLanguage, config.sourceLanguage) &&
      translationLanguagesMatch(targetLanguage, config.targetLanguage);

  Map<String, Object?> toJson() {
    return <String, Object?>{
      'available': available,
      'provider': provider,
      'sourceLanguage': sourceLanguage,
      'targetLanguage': targetLanguage,
      'status': status,
      'reason': reason,
      'message': message,
      'details': details,
    };
  }
}

abstract class MobileTranslationProvider {
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  );

  Future<void> dispose() async {}
}

abstract class MobileTranslationDiagnostics {
  Future<MobileTranslationAvailability> availability(
    MobileTranslationConfig config,
  );
}

abstract class MobileTranslationResourcePreparation {
  Future<void> prepareResources(MobileTranslationConfig config,
      {required String requestId});
  Future<void> cancelResourcePreparation(String requestId);
}
