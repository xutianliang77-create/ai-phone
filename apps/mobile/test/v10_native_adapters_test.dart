import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/asr/apple_speech_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/translation/ios_system_translation_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';
import 'package:translation_mobile/src/platform/speech/speech_output_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  const method = MethodChannel('fixture/apple-asr'),
      mt = MethodChannel('fixture/system-mt'),
      tts = MethodChannel('fixture/system-tts');
  tearDown(() {
    for (final c in [method, mt, tts]) {
      messenger.setMockMethodCallHandler(c, null);
    }
  });
  const config = MobileAsrConfig(language: 'zh');
  test(
    'ASR preflight compares effective parameters and true installed status, with no implicit download',
    () async {
      Map<String, Object?>? start;
      final provider = AppleSpeechAsrProvider(channel: method);
      messenger.setMockMethodCallHandler(method, (c) async {
        final args = Map<String, Object?>.from(c.arguments as Map);
        if (c.method == 'start') {
          start = args;
          return null;
        }
        return {
          'canStart': true,
          'resourcesInstalled': true,
          'reason': 'ready',
          'locale': 'zh-CN',
          'configurationFingerprint': 'a' * 64,
          'effectiveParameters': {
            ...args,
            'sampleRate': 16000,
            'vadFrameSamples': 4096,
          },
        };
      });
      expect((await provider.availability(config)).canStart, true);
      await provider.start(config);
      expect(start?['autoDownloadModel'], false);
      expect(start?['captureId'], isNotEmpty);
      expect(start?['languagePolicyKey'], 'fixed-zh');
      expect(
        (await provider.availability(
          const MobileAsrConfig(language: 'auto'),
        )).canStart,
        false,
      );
    },
  );
  test('a mismatched ASR configuration is never promoted to ready', () async {
    final p = AppleSpeechAsrProvider(channel: method);
    messenger.setMockMethodCallHandler(
      method,
      (_) async => {
        'canStart': true,
        'locale': 'zh-CN',
        'configurationFingerprint': 'a' * 64,
        'effectiveParameters': {'sampleRate': 8000},
      },
    );
    expect((await p.availability(config)).canStart, false);
  });
  test(
    'automatic mode requires both locale snapshots and the exact native routing policy',
    () async {
      final provider = AppleSpeechAsrProvider(channel: method);
      messenger.setMockMethodCallHandler(method, (c) async {
        final args = Map<String, Object?>.from(c.arguments as Map);
        if (c.method == 'start') {
          expect(args['languagePolicyKey'], 'apple-dual-zh-en-confidence-r1');
          return null;
        }
        return {
          'canStart': true,
          'reason': 'ready',
          'locale': 'auto',
          'locales': ['zh-CN', 'en-US'],
          'automaticLanguageImplemented': true,
          'automaticLanguageQualified': false,
          'languagePolicy': 'apple-dual-zh-en-confidence-r1',
          'configurationFingerprint': 'a' * 64,
          'effectiveParameters': {
            ...args,
            'sampleRate': 16000,
            'vadFrameSamples': 4096,
          },
        };
      });
      const auto = MobileAsrConfig(language: 'auto');
      final observed = await provider.availability(auto);
      expect(observed.canStart, true);
      expect(observed.details['automaticLanguageQualified'], false);
      await provider.start(auto);
      messenger.setMockMethodCallHandler(
        method,
        (_) async => {
          'canStart': true,
          'locale': 'auto',
          'locales': ['zh-CN'],
          'automaticLanguageImplemented': true,
          'languagePolicy': 'apple-dual-zh-en-confidence-r1',
        },
      );
      expect((await provider.availability(auto)).canStart, false);
    },
  );
  test(
    'system translation failure cannot invoke another provider; unavailable voice blocks readiness',
    () async {
      var mtCalls = 0;
      messenger.setMockMethodCallHandler(mt, (_) {
        mtCalls++;
        throw PlatformException(code: 'language_pair_not_installed');
      });
      final p = IosSystemTranslationProvider(channel: mt);
      expect(
        await p.translate(
          '本机内容',
          const MobileTranslationConfig(
            sourceLanguage: 'zh',
            targetLanguage: 'en',
          ),
        ),
        null,
      );
      expect(mtCalls, 1);
      messenger.setMockMethodCallHandler(
        tts,
        (_) async => {'canSpeak': false, 'availableOnDevice': false},
      );
      await expectLater(
        SystemSpeechOutputProvider(channel: tts).prepareVoice('en'),
        throwsStateError,
      );
    },
  );
  test(
    'empty ASR retractions survive parsing, ordinary empty text does not',
    () {
      expect(
        AsrTextSegment.tryFromJson({'id': 'x', 'text': '', 'language': 'zh'}),
        null,
      );
      expect(
        AsrTextSegment.tryFromJson({
          'id': 'x',
          'text': '',
          'language': 'zh',
          'isRetraction': true,
        })?.isRetraction,
        true,
      );
    },
  );
}
