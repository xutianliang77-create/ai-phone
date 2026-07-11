enum RegionEdition {
  domestic,
  international,
}

class RegionEditionConfig {
  const RegionEditionConfig({
    required this.edition,
    required this.defaultCountry,
    required this.allowedProviders,
    required this.paymentStack,
    required this.dataRegion,
    required this.callProviderPolicy,
    required this.complianceProfile,
  });

  const RegionEditionConfig.domestic()
      : edition = RegionEdition.domestic,
        defaultCountry = 'CN',
        allowedProviders = const <String>[
          'hymt2_self_hosted',
          'qwen_live',
          'tencent_trtc',
          'self_hosted',
          'lmstudio',
        ],
        paymentStack = const <String>[
          'apple_iap',
          'wechat_pay',
          'alipay',
          'android_channel',
        ],
        dataRegion = 'cn',
        callProviderPolicy = 'call_link_only',
        complianceProfile = 'pipl';

  const RegionEditionConfig.international()
      : edition = RegionEdition.international,
        defaultCountry = 'US',
        allowedProviders = const <String>[
          'openai',
          'gemini',
          'local',
        ],
        paymentStack = const <String>[
          'apple_iap',
          'google_play',
          'stripe',
        ],
        dataRegion = 'us',
        callProviderPolicy = 'pstn_enabled',
        complianceProfile = 'us_ca';

  final RegionEdition edition;
  final String defaultCountry;
  final List<String> allowedProviders;
  final List<String> paymentStack;
  final String dataRegion;
  final String callProviderPolicy;
  final String complianceProfile;

  bool get isDomestic => edition == RegionEdition.domestic;

  static RegionEditionConfig fromEnvironment() {
    const edition = String.fromEnvironment(
      'REGION_EDITION',
      defaultValue: 'domestic',
    );
    const dataRegion = String.fromEnvironment('DATA_REGION');
    const callProviderPolicy = String.fromEnvironment('CALL_PROVIDER_POLICY');
    const complianceProfile = String.fromEnvironment('COMPLIANCE_PROFILE');
    const allowedProviders = String.fromEnvironment('ALLOWED_PROVIDERS');
    const paymentStack = String.fromEnvironment('PAYMENT_STACK');
    return fromRaw(
      edition: edition,
      dataRegion: dataRegion,
      callProviderPolicy: callProviderPolicy,
      complianceProfile: complianceProfile,
      allowedProviders: allowedProviders,
      paymentStack: paymentStack,
    );
  }

  static RegionEditionConfig fromRaw({
    required String edition,
    String dataRegion = '',
    String callProviderPolicy = '',
    String complianceProfile = '',
    String allowedProviders = '',
    String paymentStack = '',
  }) {
    final base = edition.trim().toLowerCase() == 'international'
        ? const RegionEditionConfig.international()
        : const RegionEditionConfig.domestic();
    return base.copyWith(
      dataRegion: _valueOrNull(dataRegion),
      callProviderPolicy: _valueOrNull(callProviderPolicy),
      complianceProfile: _valueOrNull(complianceProfile),
      allowedProviders: _csvOrNull(allowedProviders),
      paymentStack: _csvOrNull(paymentStack),
    );
  }

  RegionEditionConfig copyWith({
    String? dataRegion,
    String? callProviderPolicy,
    String? complianceProfile,
    List<String>? allowedProviders,
    List<String>? paymentStack,
  }) {
    return RegionEditionConfig(
      edition: edition,
      defaultCountry: defaultCountry,
      allowedProviders: allowedProviders ?? this.allowedProviders,
      paymentStack: paymentStack ?? this.paymentStack,
      dataRegion: dataRegion ?? this.dataRegion,
      callProviderPolicy: callProviderPolicy ?? this.callProviderPolicy,
      complianceProfile: complianceProfile ?? this.complianceProfile,
    );
  }

  static String? _valueOrNull(String value) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  static List<String>? _csvOrNull(String value) {
    final values = value
        .split(',')
        .map((item) => item.trim())
        .where((item) => item.isNotEmpty)
        .toList(growable: false);
    return values.isEmpty ? null : values;
  }
}
