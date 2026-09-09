import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/asr/apple_speech_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/apple_speech_prerecorded_input.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const method = MethodChannel('translation_mobile/apple_speech_asr');
  const eventName = 'translation_mobile/apple_speech_asr/events';
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  const config = MobileAsrConfig(
      language: 'zh',
      autoDownloadModel: false,
      captureId: 'capture',
      languagePolicyKey: 'zh-en');
  final calls = <MethodCall>[];
  late AppleSpeechAsrProvider provider;
  setUp(() {
    calls.clear();
    provider = AppleSpeechAsrProvider(
        prerecordedInput: AppleSpeechPrerecordedInput(
            wavBytes: Uint8List(44), sha256: 'a' * 64));
    messenger.setMockMethodCallHandler(method, (call) async {
      calls.add(call);
      return call.method == 'isAvailable'
          ? {
              'canStart': true,
              'locale': (call.arguments as Map)['language'],
              'reason': 'ready',
              'inputKind': 'prerecorded',
              'configurationFingerprint': 'a' * 64,
              'effectiveParameters': {
                ...call.arguments as Map,
                'sampleRate': 16000,
                'vadFrameSamples': 4096
              }
            }
          : null;
    });
    messenger.setMockMethodCallHandler(
        const MethodChannel(eventName), (_) async => null);
  });
  tearDown(() async {
    await provider.dispose();
    messenger.setMockMethodCallHandler(method, null);
    messenger.setMockMethodCallHandler(const MethodChannel(eventName), null);
  });
  Future<void> emit(Map<String, Object?> payload) async {
    await messenger.handlePlatformMessage(eventName,
        const StandardMethodCodec().encodeSuccessEnvelope(payload), (_) {});
    await Future<void>.delayed(Duration.zero);
  }

  test(
      'same provider sends bounded bytes and SHA, never file paths or references',
      () async {
    expect((await provider.availability(config)).canStart, true);
    await provider.prepare(config);
    await provider.requestPermission();
    await provider.start(config);
    expect(calls.map((c) => c.method),
        ['isAvailable', 'prepare', 'requestPermission', 'start']);
    for (final call in calls) {
      final args = call.arguments as Map;
      expect(args['inputKind'], 'prerecorded');
      expect((args['prerecordedInput'] as Map).keys,
          unorderedEquals(['wav', 'sha256']));
      expect((args['prerecordedInput'] as Map)['wav'], hasLength(44));
      expect(args.containsKey('referenceText'), false);
    }
  });

  test(
      'EOF is control-only and capture-scoped; stop suppresses EOF but keeps final tail',
      () async {
    final segments = <AsrTextSegment>[];
    final completions = <Map<String, Object?>>[];
    final sub = provider.segments.listen(segments.add);
    final eofSub = provider.inputEvents.listen(completions.add);
    await Future<void>.delayed(Duration.zero);
    final eof = <String, Object?>{
      'type': 'input.completed',
      'captureId': 'capture',
      'languagePolicyKey': 'zh-en',
      'sha256': 'a' * 64
    };
    await emit(eof); // Before first capture: no accepted completion.
    await provider.start(config);
    await emit({...eof, 'captureId': 'stale'});
    await emit({...eof, 'languagePolicyKey': 'stale'});
    expect(completions, isEmpty);
    await emit(eof);
    expect(completions, hasLength(1));
    expect(segments, isEmpty);
    await provider.stop();
    await emit(eof);
    await emit({
      'type': 'segment',
      'id': 'capture:0',
      'text': '结束前的尾句',
      'captureId': 'capture',
      'languagePolicyKey': 'zh-en',
      'language': 'zh',
      'revision': 1,
      'isFinal': true
    });
    expect(completions, hasLength(1));
    expect(segments.single.text, '结束前的尾句');
    await sub.cancel();
    await eofSub.cancel();
  });

  test('old native bridge cannot silently accept prerecorded as microphone',
      () async {
    messenger.setMockMethodCallHandler(
        method,
        (call) async => {
              'canStart': true,
              'configurationFingerprint': 'a' * 64,
              'effectiveParameters': {
                ...call.arguments as Map,
                'sampleRate': 16000,
                'vadFrameSamples': 4096
              }
            });
    expect((await provider.availability(config)).canStart, false);
    messenger.setMockMethodCallHandler(method, (call) async {
      if (call.method == 'start') {
        throw PlatformException(code: 'prerecorded_input_disabled');
      }
      return null;
    });
    await expectLater(
        provider.start(config),
        throwsA(isA<PlatformException>()
            .having((e) => e.code, 'code', 'prerecorded_input_disabled')));
  });
  test(
      'QA raw text/VAD observation is capture-scoped and never becomes a routed subtitle',
      () async {
    final segments = <AsrTextSegment>[], diagnostics = <Map<String, Object?>>[];
    final sub = provider.segments.listen(segments.add);
    final observations = provider.inputEvents.listen(diagnostics.add);
    await Future<void>.delayed(Duration.zero);
    await provider.start(config);
    final raw = <String, Object?>{
      'type': 'probe.raw_segment',
      'captureId': 'capture',
      'languagePolicyKey': 'zh-en',
      'text': 'hello',
      'textLanguageObservation': {
        'evidence': 'text_only_not_acoustic',
        'dominant': 'en',
        'qualityQualified': false
      }
    };
    await emit({...raw, 'captureId': 'stale'});
    await emit(raw);
    await provider.stop();
    await emit(
        {...raw, 'isFinal': true}); // The legal stop tail remains observable.
    expect(segments, isEmpty);
    expect(diagnostics, hasLength(2));
    expect(
        (diagnostics.singleWhere(
                (d) => d['isFinal'] == true)['textLanguageObservation']
            as Map)['qualityQualified'],
        false);
    await sub.cancel();
    await observations.cancel();
  });

  test('no resource downloads or identity-free prerecorded start', () async {
    expect(
        () => provider.prepare(
            const MobileAsrConfig(language: 'zh', autoDownloadModel: true)),
        throwsArgumentError);
    await expectLater(provider.start(const MobileAsrConfig(language: 'zh')),
        throwsArgumentError);
    expect(calls, isEmpty);
  });

  test('descriptor is bounded and defensively copies source and channel bytes',
      () {
    final bytes = Uint8List(44);
    final input =
        AppleSpeechPrerecordedInput(wavBytes: bytes, sha256: 'b' * 64);
    bytes[0] = 9;
    final payload = input.toChannelArguments()['prerecordedInput'] as Map;
    expect((payload['wav'] as Uint8List)[0], 0);
    (payload['wav'] as Uint8List)[0] = 8;
    expect(
        ((input.toChannelArguments()['prerecordedInput'] as Map)['wav']
            as Uint8List)[0],
        0);
    for (final length in [43, 2000001]) {
      expect(
          () => AppleSpeechPrerecordedInput(
              wavBytes: Uint8List(length), sha256: 'b' * 64),
          throwsArgumentError);
    }
    expect(
        () => AppleSpeechPrerecordedInput(
            wavBytes: Uint8List(44), sha256: '../unsafe'),
        throwsArgumentError);
  });
}
