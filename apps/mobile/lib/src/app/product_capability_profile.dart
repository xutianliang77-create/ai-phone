class ProductCapabilityProfile {
  const ProductCapabilityProfile._({
    required this.name,
    required this.showPstn,
    required this.showAiCallingAgent,
    required this.showBilling,
    required this.showVoiceIdentity,
    required this.showVoiceProfile,
  });

  static const full = ProductCapabilityProfile._(
    name: 'full',
    showPstn: true,
    showAiCallingAgent: true,
    showBilling: true,
    showVoiceIdentity: true,
    showVoiceProfile: true,
  );

  static const coreTranslation = ProductCapabilityProfile._(
    name: 'core_translation',
    showPstn: false,
    showAiCallingAgent: false,
    showBilling: false,
    showVoiceIdentity: false,
    // Public core uses provider-managed Tencent preset TTS only. Personal
    // reference-audio profiles are not a public capability until their
    // provider deletion contract is independently qualified.
    showVoiceProfile: false,
  );

  static const _configuredName = String.fromEnvironment(
    'WUJIE_PRODUCT_PROFILE',
    defaultValue: 'full',
  );

  static ProductCapabilityProfile get current => fromName(_configuredName);

  static ProductCapabilityProfile fromName(String value) {
    return value.trim().toLowerCase() == coreTranslation.name
        ? coreTranslation
        : full;
  }

  final String name;
  final bool showPstn;
  final bool showAiCallingAgent;
  final bool showBilling;
  final bool showVoiceIdentity;
  final bool showVoiceProfile;
}
