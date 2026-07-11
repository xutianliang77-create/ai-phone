import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';

void main() {
  test('normalizes ASR language tags before sending gateway text segments', () {
    expect(normalizeAsrLanguageForGateway('en-US'), 'en');
    expect(normalizeAsrLanguageForGateway('zh-CN'), 'zh');
    expect(normalizeAsrLanguageForGateway('cmn-Hans-CN'), 'zh');
  });

  test('falls back to opposite language when ASR reports auto', () {
    expect(normalizeAsrLanguageForGateway('auto'), 'en');
    expect(
      normalizeAsrLanguageForGateway('auto', fallbackTargetLanguage: 'en'),
      'zh',
    );
  });

  test('parses native ASR segment payload defensively', () {
    final segment = AsrTextSegment.tryFromJson(<String, Object?>{
      'text': ' hello ',
      'isFinal': 'false',
    });

    expect(segment, isNotNull);
    expect(segment!.text, ' hello ');
    expect(segment.language, 'auto');
    expect(segment.isFinal, isFalse);
    expect(segment.id, startsWith('asr_'));
  });

  test('ignores malformed native ASR segment payloads', () {
    expect(AsrTextSegment.tryFromJson(<String, Object?>{}), isNull);
    expect(
      AsrTextSegment.tryFromJson(<String, Object?>{'text': '   '}),
      isNull,
    );
  });
}
