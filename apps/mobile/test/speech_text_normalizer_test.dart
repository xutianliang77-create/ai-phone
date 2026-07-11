import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/speech/speech_text_normalizer.dart';

void main() {
  test('normalizes Chinese speech text for codes, money and phone numbers', () {
    expect(
      normalizeSpeechOutputText('订单 A-120 金额 ¥31.50，电话 138-0013-8000。', 'zh'),
      '订单 A 幺 二 零 金额 31.50元，电话 幺三八 零零幺三 八零零零。',
    );
  });

  test('normalizes English speech text for codes, money and phone numbers', () {
    expect(
      normalizeSpeechOutputText(
        'Order SKU A-120 costs \$31.50, call 138-0013-8000.',
        'en',
      ),
      'Order SKU A one two zero costs 31.50 dollars, call one three eight zero zero one three eight zero zero zero.',
    );
  });

  test('keeps date-like values unchanged', () {
    expect(
      normalizeSpeechOutputText('会议日期是 2026-07-05。', 'zh'),
      '会议日期是 2026-07-05。',
    );
  });
}
