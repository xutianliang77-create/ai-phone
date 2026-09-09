import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_runtime_factories.dart';
import 'package:translation_mobile/src/platform/asr/apple_speech_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('translation_mobile/apple_speech_asr');
  const events = 'translation_mobile/apple_speech_asr/events';
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  late AppleSpeechAsrProvider provider;
  final calls = <MethodCall>[];
  setUp(() {
    calls.clear();
    provider = AppleSpeechAsrProvider();
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return call.method == 'isAvailable'
          ? {
              'canStart': true,
              'locale': (call.arguments as Map)['language'],
              'reason': 'ready',
              'qualityQualified': false,
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
        const MethodChannel(events), (_) async => null);
  });
  tearDown(() {
    messenger.setMockMethodCallHandler(channel, null);
    messenger.setMockMethodCallHandler(const MethodChannel(events), null);
  });
  test(
      'existing app factory selects Apple without changing repository preference',
      () {
    final config = AppConfig(
      apiBaseUrl: Uri.parse('http://localhost:3100'),
      useMockAudio: false,
      useDeviceAsr: true,
      deviceAsrProvider: 'apple_speech_transcriber',
      deviceAsrLanguage: 'en',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 2240,
      serverOwnedHistory: true,
      sourceLanguage: 'ja',
      useLocalSessions: false,
    );
    expect(
        createDefaultMobileAsrProvider(config), isA<AppleSpeechAsrProvider>());
    final native = createDeviceAsrConfig(config);
    expect(native.language, 'ja');
    expect(native.chunkDurationMs, 32);
    expect(native.endpointMinSpeechMs, 96);
    expect(native.endpointSilenceMs, 640);
    expect(config.useLocalSessions, false);
    expect(
        createDeviceAsrConfig(config.copyWith(sourceLanguage: 'auto')).language,
        'auto');
  });
  test('passes user language and explicit resource download setting', () async {
    const config =
        MobileAsrConfig(language: 'zh-Hant', autoDownloadModel: false);
    await provider.prepare(config);
    await provider.start(config);
    await provider.stop();
    expect(calls.map((c) => c.method), ['prepare', 'start', 'stop']);
    expect(calls[1].arguments, {
      'language': 'zh-Hant',
      'autoDownloadModel': false,
      'chunkDurationMs': 320,
      'endpointMinSpeechMs': 600,
      'endpointSilenceMs': 900,
      'vadProvider': 'fluidaudio_silero',
      'vadThreshold': 0.6,
      'vadNegativeThreshold': 0.35,
      'vadPreRollMs': 800,
    });
  });
  test('availability is readiness, not quality qualification', () async {
    final result =
        await provider.availability(const MobileAsrConfig(language: 'en'));
    expect(result.canStart, true);
    expect(result.details['qualityQualified'], false);
  });
  test('ready and local registration must report a matching actual ASR locale',
      () async {
    for (final canStart in [true, false]) {
      messenger.setMockMethodCallHandler(
          channel,
          (call) async => {
                'canStart': canStart,
                'canPrepareLocally': !canStart,
                'locale': 'en-US',
                'configurationFingerprint': 'a' * 64,
                'effectiveParameters': {
                  ...call.arguments as Map,
                  'sampleRate': 16000,
                  'vadFrameSamples': 4096
                },
              });
      final value =
          await provider.availability(const MobileAsrConfig(language: 'fr'));
      expect(value.canStart, false);
      expect(value.details['canPrepareLocally'], false);
      expect(value.reason, 'asr_configuration_mismatch');
    }
  });
  test('capture rotation filters old native segments and failures', () async {
    final received = <AsrTextSegment>[];
    final errors = <Object>[];
    final sub = provider.segments.listen(received.add, onError: errors.add);
    await Future<void>.delayed(Duration.zero);
    await provider.start(const MobileAsrConfig(
        language: 'en', captureId: 'old', languagePolicyKey: 'pair'));
    await provider.stop();
    await provider.start(const MobileAsrConfig(
        language: 'en', captureId: 'new', languagePolicyKey: 'pair'));
    for (final payload in [
      {
        'type': 'segment',
        'id': 'old:0',
        'text': 'old',
        'language': 'en',
        'captureId': 'old',
        'languagePolicyKey': 'pair',
        'revision': 1
      },
      {
        'type': 'runtime.error',
        'code': 'old_error',
        'captureId': 'old',
        'languagePolicyKey': 'pair'
      },
      {
        'type': 'segment',
        'id': 'new:0',
        'text': 'current',
        'language': 'en',
        'captureId': 'new',
        'languagePolicyKey': 'pair',
        'revision': 1
      },
    ]) {
      await messenger.handlePlatformMessage(events,
          const StandardMethodCodec().encodeSuccessEnvelope(payload), (_) {});
    }
    await Future<void>.delayed(Duration.zero);
    expect(received.single.text, 'current');
    expect(errors, isEmpty);
    expect((calls.last.arguments as Map)['captureId'], 'new');
    await sub.cancel();
  });
  test(
      'failed readiness preserves exact native resource snapshot without recheck',
      () async {
    const snapshot = {
      'requestedLanguage': 'fr',
      'resolvedLocale': 'fr-FR',
      'assetStatus': 'supported',
      'installedLocales': ['fr-FR'],
      'reservedLocales': <String>[],
      'stage': 'availability',
    };
    messenger.setMockMethodCallHandler(
        channel,
        (_) async => {
              'canStart': false,
              'reason': 'language_resource_not_ready',
              'locale': 'fr-FR',
              'resourceSnapshot': snapshot,
            });
    final observed =
        await provider.availability(const MobileAsrConfig(language: 'fr'));
    expect(identical(provider.lastAvailability, observed), true);
    expect(observed.canStart, false);
    expect(observed.details['resourceSnapshot'], snapshot);
    expect(() => observed.details['resourceSnapshot'] = {},
        throwsUnsupportedError);
  });
  test(
      'prepare failure keeps native stage and resource state; new check clears stale failure',
      () async {
    messenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'prepare') {
        throw PlatformException(
            code: 'language_resource_downloading',
            details: {'stage': 'prepare_after', 'assetStatus': 'downloading'});
      }
      return {'canStart': false, 'reason': 'language_resource_downloading'};
    });
    await expectLater(provider.prepare(const MobileAsrConfig(language: 'fr')),
        throwsA(isA<PlatformException>()));
    expect(provider.lastResourceFailure?['details'],
        {'stage': 'prepare_after', 'assetStatus': 'downloading'});
    await provider.stop();
    expect(
        provider.lastResourceFailure?['code'], 'language_resource_downloading');
    await provider.availability(const MobileAsrConfig(language: 'ja'));
    expect(provider.lastResourceFailure, isNull);
  });
  test('missing resources and automatic language are explicit failures',
      () async {
    messenger.setMockMethodCallHandler(
        channel,
        (_) async =>
            {'canStart': false, 'reason': 'automaticLanguageNotQualified'});
    expect(
        (await provider.availability(const MobileAsrConfig(
                language: 'auto', autoDownloadModel: true)))
            .canStart,
        false);
    messenger.setMockMethodCallHandler(
        channel,
        (_) async =>
            {'canStart': false, 'reason': 'language_resource_missing'});
    expect(
        (await provider.availability(const MobileAsrConfig(language: 'en')))
            .canStart,
        false);
    expect(
        (await provider.availability(
                const MobileAsrConfig(language: 'en', autoDownloadModel: true)))
            .canStart,
        false);
  });
  test(
      'passes customized parameters unchanged to prepare, availability and start',
      () async {
    const config = MobileAsrConfig(
        language: 'fr',
        chunkDurationMs: 48,
        endpointMinSpeechMs: 512,
        endpointSilenceMs: 768,
        vadThreshold: 0.8,
        vadNegativeThreshold: 0.3,
        vadPreRollMs: 256);
    await provider.prepare(config);
    expect((await provider.availability(config)).canStart, true);
    await provider.start(config);
    for (final call in calls) {
      expect((call.arguments as Map)['chunkDurationMs'], 48);
      expect((call.arguments as Map)['endpointMinSpeechMs'], 512);
      expect((call.arguments as Map)['endpointSilenceMs'], 768);
      expect((call.arguments as Map)['vadThreshold'], 0.8);
      expect((call.arguments as Map)['vadNegativeThreshold'], 0.3);
      expect((call.arguments as Map)['vadPreRollMs'], 256);
    }
  });
  test('rejects ready when native parameters differ or metadata is absent',
      () async {
    messenger.setMockMethodCallHandler(
        channel,
        (call) async => {
              'canStart': true,
              'reason': 'ready',
              'configurationFingerprint': 'a' * 64,
              'effectiveParameters': {
                ...call.arguments as Map,
                'sampleRate': 16000,
                'vadFrameSamples': 4096,
                'vadThreshold': 0.9
              }
            });
    final mismatch =
        await provider.availability(const MobileAsrConfig(language: 'en'));
    expect(mismatch.canStart, false);
    expect(mismatch.reason, 'asr_configuration_mismatch');
    messenger.setMockMethodCallHandler(
        channel, (_) async => {'canStart': true});
    expect(
        (await provider.availability(const MobileAsrConfig(language: 'en')))
            .canStart,
        false);
  });
  test(
      'stream preserves segment identity and finals, ignores VAD markers, propagates failures',
      () async {
    final received = <dynamic>[];
    final errors = <Object>[];
    final sub = provider.segments.listen(received.add, onError: errors.add);
    await Future<void>.delayed(Duration.zero);
    for (final payload in [
      {'type': 'vad.boundary', 'speechStarted': true},
      {
        'type': 'segment',
        'id': 'session:0',
        'text': 'hello',
        'language': 'en',
        'languageEvidence': 'user_selected',
        'isFinal': false
      },
      {
        'type': 'segment',
        'id': 'session:0',
        'text': 'hello world',
        'language': 'en',
        'languageEvidence': 'user_selected',
        'isFinal': true
      },
      {
        'type': 'runtime.error',
        'code': 'queueOverflow',
        'message': 'input full'
      },
    ]) {
      await messenger.handlePlatformMessage(events,
          const StandardMethodCodec().encodeSuccessEnvelope(payload), (_) {});
    }
    await Future<void>.delayed(Duration.zero);
    expect(received.length, 2);
    expect(received[0].id, received[1].id);
    expect(received[0].isFinal, false);
    expect(received[1].isFinal, true);
    expect(received.map((segment) => segment.languageEvidence),
        everyElement(AsrLanguageEvidence.userSelected));
    expect(errors.single, isA<PlatformException>());
    await sub.cancel();
  });
}
