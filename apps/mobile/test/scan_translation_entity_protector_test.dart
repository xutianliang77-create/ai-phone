import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/scan/domain/scan_translation_entity_protector.dart';

void main() {
  test('bypasses standalone certification model vendor and numeric labels', () {
    for (final text in const <String>[
      'CE',
      'DELL',
      'Dell Technologies',
      'DPS-750AB-29A',
      '100-240V 50/60Hz 8A',
      'CE —',
    ]) {
      expect(
        ScanTranslationEntityProtector(text).canBypassTranslation,
        isTrue,
        reason: text,
      );
    }

    expect(
      ScanTranslationEntityProtector('WARNING').canBypassTranslation,
      isFalse,
    );
    expect(
      ScanTranslationEntityProtector('Risk of electric shock')
          .canBypassTranslation,
      isFalse,
    );
  });

  test('protects a title-case vendor when a scan label identifies it', () {
    const source = '制造商: Apple 型号 A2894';
    final protector = ScanTranslationEntityProtector(source);

    expect(protector.translationInput, isNot(contains('Apple')));
    expect(protector.translationInput, isNot(contains('A2894')));
    expect(
      protector.restore(protector.translationInput),
      contains('Apple 型号 A2894'),
    );
  });

  test('masks and restores mixed manufacturer model and numeric entities', () {
    const source = '制造商 Dell Technologies 型号 DPS-750AB-29A 输入 100-240V';
    final protector = ScanTranslationEntityProtector(source);

    expect(protector.canBypassTranslation, isFalse);
    expect(protector.translationInput, isNot(contains('Dell Technologies')));
    expect(protector.translationInput, isNot(contains('DPS-750AB-29A')));
    expect(protector.translationInput, isNot(contains('100-240V')));

    final providerText = protector.translationInput
        .replaceAll('制造商', 'Manufacturer')
        .replaceAll('型号', 'model')
        .replaceAll('输入', 'input');
    final restored = protector.restore(providerText);

    expect(restored, contains('Dell Technologies'));
    expect(restored, contains('DPS-750AB-29A'));
    expect(restored, contains('100-240V'));
    expect(restored, isNot(contains('WJ_ENTITY')));
  });

  test('restores markers whose label was translated by the provider', () {
    const source = 'DELL P/N:HYV3H';
    final protector = ScanTranslationEntityProtector(source);
    final providerText = protector.translationInput.replaceAll(
      RegExp(r'WJ_'),
      'WJ_实体_',
    );

    final restored = protector.restore(providerText);

    expect(restored, 'DELL P/N:HYV3H');
    expect(restored, isNot(contains('WJ')));
    expect(restored, isNot(contains('实体')));
  });

  test('normalizes the common Vision OCR confusable for the CE mark', () {
    expect(
      normalizeScanTranslationEntities('SWITCHING POWER SUPPLY\nC€\n80 PLUS'),
      'SWITCHING POWER SUPPLY\nCE\n80 PLUS',
    );
    expect(normalizeScanTranslationEntities('Price C€100'), 'Price C€100');
  });

  test('rejects translations that strip protected entities', () {
    const source = 'CE 型号 DPS-750AB 金额 1,299.00';
    final protector = ScanTranslationEntityProtector(source);
    expect(
      () => protector.restore('Certified ce model dps-750ab amount'),
      throwsA(isA<ScanEntityRestorationFailure>()),
    );
  });
}
