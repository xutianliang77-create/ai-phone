import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/speech/speech_output_provider.dart';

Map<String, Object?> voicePayload(
        {String language = 'fr',
        String voiceLanguage = 'fr-FR',
        String id = 'com.apple.voice.test.fr',
        bool finished = false}) =>
    {
      'protocolVersion': 1,
      'provider': 'ios_system_tts',
      'language': language,
      'canSpeak': true,
      'availableOnDevice': true,
      'voiceIdentifier': id,
      'voiceLanguage': voiceLanguage,
      'voiceName': 'System test voice',
      'voiceQuality': 2,
      'voicePolicy': 'apple_system_standard_v1',
      'reason': 'voice_available_on_device',
      'offlineVerified': false,
      if (finished) 'completion': 'finished',
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('translation_mobile/speech_output');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  late SystemSpeechOutputProvider provider;
  final calls = <MethodCall>[];
  setUp(() {
    calls.clear();
    provider = SystemSpeechOutputProvider(platform: TargetPlatform.iOS);
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return call.method == 'stop'
          ? null
          : voicePayload(finished: call.method == 'speak');
    });
  });
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));
  test(
      'inspection returns exact on-device voice without speaking or offline qualification',
      () async {
    final result = await provider.availability('fr');
    expect(result.canSpeak, true);
    expect(result.voice?.language, 'fr-FR');
    expect(result.voice?.identifier, 'com.apple.voice.test.fr');
    expect(result.offlineVerified, false);
    expect(result.qualityQualified, false);
    expect(calls.single.method, 'isAvailable');
    expect(calls.single.arguments, {'language': 'fr'});
  });
  test('speak pins inspected voice and returns actual completed identity',
      () async {
    final result = await provider.speak(text: 'Bonjour', language: 'fr');
    expect(calls.map((c) => c.method), ['isAvailable', 'speak']);
    expect(calls.last.arguments, {
      'text': 'Bonjour',
      'language': 'fr',
      'voiceIdentifier': 'com.apple.voice.test.fr'
    });
    expect(result.voice?.identifier, 'com.apple.voice.test.fr');
    expect(result.voice?.language, 'fr-FR');
  });
  test('old bridge and missing resources fail before any speech', () async {
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return {'canSpeak': true};
    });
    await expectLater(provider.speak(text: 'Bonjour', language: 'fr'),
        throwsA(isA<PlatformException>()));
    expect(calls.map((c) => c.method), ['isAvailable']);
    messenger.setMockMethodCallHandler(channel,
        (_) async => {'canSpeak': false, 'reason': 'speech_voice_unavailable'});
    expect((await provider.availability('fr')).canSpeak, false);
  });
  test(
      'completed speech retains actual start timing without inventing missing values',
      () async {
    messenger.setMockMethodCallHandler(
        channel,
        (call) async => {
              ...voicePayload(finished: call.method == 'speak'),
              if (call.method == 'speak')
                'timing': {
                  'nativeRequestToStartMs': 120,
                  'nativeSpeakingMs': 600,
                  'nativeTotalMs': 720,
                }
            });
    final result = await provider.speak(text: 'Bonjour', language: 'fr');
    expect(result.timings['nativeRequestToStartMs'], 120);
    expect(result.timings['nativeSpeakingMs'], 600);
    expect(result.timings['voiceAvailabilityMs'], greaterThanOrEqualTo(0));
    expect(result.timings['platformSpeakMs'], greaterThanOrEqualTo(0));
  });
  test('invalid timing cannot masquerade as zero start delay', () async {
    messenger.setMockMethodCallHandler(
        channel,
        (call) async => {
              ...voicePayload(finished: call.method == 'speak'),
              if (call.method == 'speak')
                'timing': {
                  'nativeRequestToStartMs': -1,
                  'nativeSpeakingMs': 'unknown'
                }
            });
    final result = await provider.speak(text: 'Bonjour', language: 'fr');
    expect(result.timings.containsKey('nativeRequestToStartMs'), false);
    expect(result.timings.containsKey('nativeSpeakingMs'), false);
  });
  test(
      'wrong locale, provider, echoed language and unknown voice IDs cannot be ready',
      () async {
    for (final payload in [
      voicePayload(voiceLanguage: 'en-US'),
      voicePayload(language: 'en'),
      voicePayload(id: 'third.party.voice'),
      {...voicePayload(), 'provider': 'android_system_tts'}
    ]) {
      messenger.setMockMethodCallHandler(channel, (_) async => payload);
      expect((await provider.availability('fr')).canSpeak, false);
    }
  });
  test(
      'changed voice and missing completion are playback errors, not fabricated success',
      () async {
    for (final payload in [
      voicePayload(id: 'com.apple.voice.other', finished: true),
      voicePayload()
    ]) {
      messenger.setMockMethodCallHandler(
          channel,
          (call) async =>
              call.method == 'isAvailable' ? voicePayload() : payload);
      await expectLater(
          provider.speak(text: 'Bonjour', language: 'fr'),
          throwsA(isA<PlatformException>().having(
              (e) => e.code, 'code', 'speech_voice_confirmation_failed')));
    }
  });
  test('stop during catalog lookup prevents late speak from reviving playback',
      () async {
    final reply = Completer<Map<String, Object?>>();
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return call.method == 'isAvailable' ? reply.future : null;
    });
    final pending = provider.speak(text: 'Bonjour', language: 'fr');
    final assertion = expectLater(
        pending,
        throwsA(isA<PlatformException>()
            .having((e) => e.code, 'code', 'speech_cancelled')));
    await pumpEventQueue();
    await provider.stop();
    reply.complete(voicePayload());
    await assertion;
    expect(calls.map((c) => c.method), ['isAvailable', 'stop']);
  });
  test('native playback failure propagates unchanged', () async {
    messenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'speak') {
        throw PlatformException(code: 'audio_session_unavailable');
      }
      return voicePayload();
    });
    await expectLater(
        provider.speak(text: 'Bonjour', language: 'fr'),
        throwsA(isA<PlatformException>()
            .having((e) => e.code, 'code', 'audio_session_unavailable')));
  });
  test(
      'replacement stops the old utterance even when the new voice is unavailable',
      () async {
    final oldSpeech = Completer<Map<String, Object?>>();
    var inspections = 0;
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      if (call.method == 'isAvailable') {
        return ++inspections == 1
            ? voicePayload()
            : {'canSpeak': false, 'reason': 'speech_voice_unavailable'};
      }
      if (call.method == 'speak') return oldSpeech.future;
      oldSpeech.completeError(PlatformException(code: 'speech_cancelled'));
      return null;
    });
    final first = provider.speak(text: 'Bonjour', language: 'fr');
    final firstFailed = expectLater(first, throwsA(isA<PlatformException>()));
    await pumpEventQueue();
    await expectLater(provider.speak(text: '次の文', language: 'ja'),
        throwsA(isA<PlatformException>()));
    await firstFailed;
    expect(calls.map((c) => c.method),
        ['isAvailable', 'speak', 'stop', 'isAvailable']);
  });
  test(
      'Android keeps its existing speech wire contract and is not marked iOS-offline ready',
      () async {
    final android =
        SystemSpeechOutputProvider(platform: TargetPlatform.android);
    expect((await android.availability('fr')).canSpeak, false);
    expect(calls, isEmpty);
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return {'provider': 'android_system_tts', 'language': 'fr'};
    });
    expect((await android.speak(text: 'Bonjour', language: 'fr')).provider,
        'android_system_tts');
    expect(calls.single.arguments, {'text': 'Bonjour', 'language': 'fr'});
  });
  test(
      'language matcher preserves explicit regions/scripts and does not infer Cantonese aliases',
      () {
    for (final pair in [
      ('fr-FR', 'fr', true),
      ('en-US', 'en-GB', false),
      ('en_GB', 'en-GB', true),
      ('zh-TW', 'zh-Hant', true),
      ('zh-HK', 'zh-Hant', false),
      ('zh-CN', 'zh-Hant', false),
      ('zh-HK', 'yue', false),
      ('zh-HK', 'cmn-HK', false),
      ('yue-HK', 'yue', true),
      ('sr-Cyrl-RS', 'sr-Latn', false),
      ('sr-Latn-RS', 'sr-Latn', true),
      ('und-US', 'und-US', false)
    ]) {
      expect(speechVoiceLanguageMatches(pair.$1, pair.$2), pair.$3,
          reason: '${pair.$1}/${pair.$2}');
    }
  });
}
