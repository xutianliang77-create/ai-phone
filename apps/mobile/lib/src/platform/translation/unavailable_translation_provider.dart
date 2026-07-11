import 'mobile_translation_provider.dart';

class UnavailableTranslationProvider
    implements MobileTranslationProvider, MobileTranslationDiagnostics {
  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    return null;
  }

  @override
  Future<void> dispose() async {}

  @override
  Future<MobileTranslationAvailability> availability(
    MobileTranslationConfig config,
  ) async {
    return MobileTranslationAvailability(
      available: false,
      provider: 'unavailable',
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
      status: 'unavailable',
      reason: 'unsupported_platform',
    );
  }
}
