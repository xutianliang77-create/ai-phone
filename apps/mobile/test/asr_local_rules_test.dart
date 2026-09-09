import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/asr_local_rules.dart';

void main() {
  final fixture = jsonDecode(
      File('test/fixtures/v10_asr_local_rules.json').readAsStringSync()) as Map;
  for (final row in fixture['vectors'] as List) {
    test('frozen v1.0 rule parity: ${row['raw']}', () {
      final result = applyAsrLocalRules(row['raw'] as String,
          protectedTerms: (row['terms'] as List?)?.cast<String>());
      expect(result.toJson(), row['expected']);
    });
  }
  test('phone uses existing meeting correction without changing raw input', () {
    const raw = '请把会议既要发给李明确认';
    final result =
        refinePhoneAsrText(raw, language: 'zh', domainPack: 'product');
    expect(result.text, '请把会议纪要发给李明确认');
    expect(result.operations, ['term_correction']);
    expect(raw, '请把会议既要发给李明确认');
  });
  test('phone applies only the selected domain and never hidden cultivation',
      () {
    expect(
        refinePhoneAsrText('甲状线节节', language: 'zh', domainPack: 'medical').text,
        '甲状腺结节');
    expect(
        refinePhoneAsrText('甲状线节节', language: 'zh', domainPack: 'product').text,
        '甲状线节节');
    expect(
        refinePhoneAsrText('维修车辆出机油', language: 'zh', domainPack: 'product')
            .text,
        '维修车辆出机油');
    expect(
        refinePhoneAsrText('同船出海', language: 'zh', domainPack: 'travel').text,
        '同船出海');
  });
  test('non zh/en and unresolved language are not rewritten', () {
    for (final language in ['de', 'ja', null]) {
      expect(
          refinePhoneAsrText('er 会议既要',
                  language: language, domainPack: 'product')
              .text,
          'er 会议既要');
    }
  });
  test('empty cleanup retains raw speech instead of deleting the segment', () {
    final result =
        refinePhoneAsrText('um', language: 'en', domainPack: 'product');
    expect(result.text, 'um');
    expect(result.warnings, contains('empty_optimized_text_kept_raw'));
  });
}
