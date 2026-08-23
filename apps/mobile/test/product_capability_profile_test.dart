import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/product_capability_profile.dart';

void main() {
  test('core translation hides capabilities that have not passed release gates',
      () {
    const profile = ProductCapabilityProfile.coreTranslation;

    expect(profile.name, 'core_translation');
    expect(profile.showPstn, isFalse);
    expect(profile.showAiCallingAgent, isFalse);
    expect(profile.showBilling, isFalse);
    expect(profile.showVoiceIdentity, isFalse);
  });

  test('unknown profile names preserve the existing full development surface',
      () {
    expect(ProductCapabilityProfile.fromName('core_translation'),
        same(ProductCapabilityProfile.coreTranslation));
    expect(ProductCapabilityProfile.fromName('unexpected'),
        same(ProductCapabilityProfile.full));
  });
}
