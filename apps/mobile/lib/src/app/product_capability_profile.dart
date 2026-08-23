class ProductCapabilityProfile {
  const ProductCapabilityProfile._({
    required this.name,
    required this.showPstn,
    required this.showAiCallingAgent,
    required this.showBilling,
    required this.showVoiceIdentity,
  });

  static const full = ProductCapabilityProfile._(
    name: 'full',
    showPstn: true,
    showAiCallingAgent: true,
    showBilling: true,
    showVoiceIdentity: true,
  );

  static const coreTranslation = ProductCapabilityProfile._(
    name: 'core_translation',
    showPstn: false,
    showAiCallingAgent: false,
    showBilling: false,
    showVoiceIdentity: false,
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
}
