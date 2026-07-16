import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/translation_text_protection.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

void main() {
  test('protects English terms and numeric literals in Chinese source', () {
    final protected = protectTranslationText(
      '个人版现有61项 WIP，金额¥31.50，型号A-120，947项通过',
      const MobileTranslationConfig(
        sourceLanguage: 'zh',
        targetLanguage: 'en',
      ),
    );

    expect(protected.text, isNot(contains('WIP')));
    expect(protected.text, isNot(contains('¥31.50')));
    expect(protected.text, isNot(contains('A-120')));
    final restored = protected.restore(
      'The personal edition has XTLKEEP0QXZ items, '
      'XTLKEEP1QXZ, amount XTLKEEP2QXZ, model XTLKEEP3QXZ, '
      'and XTLKEEP4QXZ passed.',
    );

    expect(restored, contains('61'));
    expect(restored, contains('WIP'));
    expect(restored, contains('¥31.50'));
    expect(restored, contains('A-120'));
    expect(restored, contains('947'));
  });

  test('protects Chinese terms and numbers in English source', () {
    final protected = protectTranslationText(
      'Release 无界AI v2 on 2026-07-16 at 15:30 with 99% accuracy',
      const MobileTranslationConfig(
        sourceLanguage: 'en',
        targetLanguage: 'zh',
      ),
    );

    expect(protected.text, isNot(contains('无界')));
    expect(protected.text, isNot(contains('2026-07-16')));
    final restored = protected.restore(
      '在 XTLKEEP0QXZXTLKEEP1QXZ 发布 XTLKEEP2QXZ '
      'XTLKEEP3QXZ，时间 XTLKEEP4QXZ，准确率 XTLKEEP5QXZ',
    );

    expect(
      restored,
      '在 无界AI 发布 v2 2026-07-16，时间 15:30，准确率 99%',
    );
  });

  test('does not reverse-translate embedded AR, M, or lower-case terms', () {
    final protected = protectTranslationText(
      '访问 AR 和 M，并保留 lo',
      const MobileTranslationConfig(
        sourceLanguage: 'zh',
        targetLanguage: 'en',
      ),
    );

    expect(
      protected.restore(
        'Access XTLKEEP0QXZ and XTLKEEP1QXZ, and keep XTLKEEP2QXZ.',
      ),
      'Access AR and M, and keep lo.',
    );
  });

  test('restores markers after translator changes case and spacing', () {
    final protected = protectTranslationText(
      '金额是¥31.50',
      const MobileTranslationConfig(
        sourceLanguage: 'zh',
        targetLanguage: 'en',
      ),
    );

    expect(
      protected.restore('The amount is x t l k e e p 0 q x z.'),
      'The amount is ¥31.50.',
    );
  });

  test('returns null when a translator drops a marker', () {
    final protected = protectTranslationText(
      '共有947项',
      const MobileTranslationConfig(
        sourceLanguage: 'zh',
        targetLanguage: 'en',
      ),
    );

    expect(protected.restore('There are many items.'), isNull);
  });
}
