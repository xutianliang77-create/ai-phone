import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/translation/supported_translation_language.dart';

void main() {
  test('retraction requires explicit empty nonfinal versioned identity', () {
    final data = <String, Object?>{
      'id': 'c:0', 'text': '', 'language': 'zh', 'isFinal': false,
      'isRetraction': true, 'captureId': 'c', 'languagePolicyKey': 'p',
      'revision': 2,
    };
    expect(AsrTextSegment.fromJson(data).copyWith().isRetraction, isTrue);
    for (final bad in [
      {...data, 'id': ''}, {...data, 'text': 'not empty'},
      {...data, 'isFinal': true}, {...data, 'captureId': null},
      {...data, 'isRetraction': false},
      {'text': '', 'isRetraction': true, 'isFinal': false},
    ]) {
      expect(AsrTextSegment.tryFromJson(bad), isNull);
    }
  });
  test(
      'versioned events missing language evidence cannot downgrade to legacy heuristics',
      () {
    final versioned = AsrTextSegment.fromJson({
      'text': 'Bonjour',
      'language': 'fr',
      'captureId': 'c',
      'languagePolicyKey': 'p',
      'revision': 1
    });
    expect(versioned.languageEvidence, AsrLanguageEvidence.unknown);
    expect(
        AsrTextSegment.fromJson({'text': 'Bonjour', 'language': 'fr'})
            .languageEvidence,
        AsrLanguageEvidence.legacy);
    for (final bad in ['fr--FR', 'en??', 'zh-', 'en-@US', 'und-US']) {
      expect(normalizeAsrLanguage(bad), isNull);
    }
  });
  test('native capture/policy/revision metadata is atomic and survives copies',
      () {
    final data = <String, Object?>{
      'id': 'c:0',
      'text': 'hello',
      'language': 'en',
      'isFinal': false,
      'captureId': 'c',
      'languagePolicyKey': 'policy',
      'revision': 2,
    };
    final segment =
        AsrTextSegment.fromJson(data).copyWith(text: 'hello!', isFinal: true);
    expect(segment.captureId, 'c');
    expect(segment.languagePolicyKey, 'policy');
    expect(segment.revision, 2);
    for (final bad in [
      {...data, 'revision': -1},
      {...data, 'revision': '2'},
      {...data, 'captureId': null},
      {...data, 'languagePolicyKey': ''},
    ]) {
      expect(AsrTextSegment.tryFromJson(bad), isNull);
    }
  });
  test('preserves every existing product language and regional ASR tag', () {
    for (final language in supportedHyMtLanguages) {
      expect(normalizeAsrLanguage(language.code), language.code);
      expect(normalizeAsrLanguageForGateway(language.code), language.code);
    }
    for (final tag in {
      'fr-FR': 'fr',
      'ja_JP': 'ja',
      'PT-br': 'pt',
      'yue-Hant-HK': 'yue',
      'zh-Hant-TW': 'zh-Hant',
      'cmn-Hant': 'zh-Hant',
      'zh_TW': 'zh-Hant',
      'zh-Hans-HK': 'zh',
      ' en-GB ': 'en',
    }.entries) {
      expect(normalizeAsrLanguageForGateway(tag.key), tag.value);
    }
    for (final tag in ['', 'auto', 'turn', 'mixed', 'unknown', 'zz-ZZ']) {
      expect(normalizeAsrLanguage(tag), isNull);
    }
  });

  test('parses provenance and preserves it when cleaning or finalizing text',
      () {
    for (final evidence in {
      'user_selected': AsrLanguageEvidence.userSelected,
      'detected': AsrLanguageEvidence.detected,
      'text_inferred': AsrLanguageEvidence.textInferred,
      'mixed': AsrLanguageEvidence.mixed,
      'unknown': AsrLanguageEvidence.unknown,
      'invalid': AsrLanguageEvidence.unknown,
    }.entries) {
      final segment = AsrTextSegment.fromJson({
        'id': 'asr_1',
        'text': ' bonjour ',
        'language': 'fr-FR',
        'languageEvidence': evidence.key,
        'isFinal': false,
        'confidence': 0.8,
      }).copyWith(text: 'bonjour', isFinal: true);
      expect(segment.languageEvidence, evidence.value);
      expect(segment.id, 'asr_1');
      expect(segment.language, 'fr-FR');
      expect(segment.text, 'bonjour');
      expect(segment.isFinal, true);
      expect(segment.confidence, 0.8);
    }
    expect(AsrTextSegment.fromJson({'text': 'test'}).languageEvidence,
        AsrLanguageEvidence.legacy);
    expect(
        AsrTextSegment.fromJson({'text': 'test', 'languageEvidence': null})
            .languageEvidence,
        AsrLanguageEvidence.unknown);
  });

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
