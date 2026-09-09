import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/asr/apple_speech_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/apple_speech_prerecorded_input.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';
import 'package:translation_mobile/src/platform/translation/ios_system_translation_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const asrChannel = MethodChannel('translation_mobile/apple_speech_asr');
  const mtChannel = MethodChannel('translation_mobile/on_device_translation');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final calls = <MethodCall>[];
  setUp(() {
    calls.clear();
    for (final channel in [asrChannel, mtChannel]) {
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        return null;
      });
    }
  });
  tearDown(() {
    for (final channel in [asrChannel, mtChannel]) {
      messenger.setMockMethodCallHandler(channel, null);
    }
  });
  test(
      'Apple explicit preparation carries authorization, language, parameters and cancellation identity',
      () async {
    final provider = AppleSpeechAsrProvider();
    await provider.prepareResources(
        const MobileAsrConfig(
            language: 'de', autoDownloadModel: true, endpointMinSpeechMs: 256),
        requestId: 'asr-de-1');
    await provider.cancelResourcePreparation('asr-de-1');
    expect(calls.map((c) => c.method), ['prepare', 'cancelPreparation']);
    final args = calls.first.arguments as Map;
    expect(args['language'], 'de');
    expect(args['endpointMinSpeechMs'], 256);
    expect(args['downloadAuthorized'], true);
    expect(args['autoDownloadModel'], true);
    expect(args['requestId'], 'asr-de-1');
    expect(calls.last.arguments, {'requestId': 'asr-de-1'});
  });
  test('normal warm-up remains separate and prerecorded QA cannot download',
      () async {
    final provider = AppleSpeechAsrProvider();
    await provider.prepare(
        const MobileAsrConfig(language: 'de', autoDownloadModel: false));
    expect((calls.single.arguments as Map).containsKey('downloadAuthorized'),
        false);
    final qa = AppleSpeechAsrProvider(
        prerecordedInput: AppleSpeechPrerecordedInput(
            wavBytes: Uint8List(44), sha256: 'a' * 64));
    expect(
        () => qa.prepareResources(
            const MobileAsrConfig(language: 'de', autoDownloadModel: true),
            requestId: 'qa'),
        throwsArgumentError);
    expect(calls, hasLength(1));
  });
  test('MT uses resource method without source text, translation or fallback',
      () async {
    final provider = IosSystemTranslationProvider();
    await provider.prepareResources(
        const MobileTranslationConfig(
            sourceLanguage: 'fr', targetLanguage: 'ja'),
        requestId: 'mt-1');
    await provider.cancelResourcePreparation('mt-1');
    expect(calls.map((c) => c.method), ['prepare', 'cancelPreparation']);
    expect(calls.first.arguments, {
      'sourceLanguage': 'fr',
      'targetLanguage': 'ja',
      'requestId': 'mt-1',
      'downloadAuthorized': true
    });
    expect(calls.last.arguments, {'requestId': 'mt-1'});
  });
  test('native preparation errors are not converted to success', () async {
    messenger.setMockMethodCallHandler(mtChannel, (_) async {
      throw PlatformException(code: 'resource_storage_full');
    });
    await expectLater(
        IosSystemTranslationProvider().prepareResources(
            const MobileTranslationConfig(
                sourceLanguage: 'fr', targetLanguage: 'ja'),
            requestId: 'mt-2'),
        throwsA(isA<PlatformException>()
            .having((e) => e.code, 'code', 'resource_storage_full')));
  });
}
