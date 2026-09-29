import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/asr/device_text_language.dart';
import 'public_gateway_start_test.dart' as gateway;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final fixture = jsonDecode(
      File('../../packages/contracts/fixtures/device-text-language-v1.json')
          .readAsStringSync()) as Map;
  final request = Map<String, Object?>.from(fixture['request'] as Map);
  const observation = {
    'method': deviceTextLanguageMethod,
    'evidence': 'text_only_not_acoustic',
    'dominant': 'fr',
    'hypotheses': {'fr': 0.98, 'en': 0.01}
  };
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('translation_mobile/text_language'), null);
  });
  test(
      'mobile emits the SAME shared server contract from native text observations',
      () async {
    final result =
        await answerTextLanguageChallenge(request, 'session', (text) async {
      expect(text, request['text']);
      return observation;
    });
    expect(result, fixture['response']);
    expect(result!.containsKey('text'), false);
  });
  test(
      'wrong owner session, modified text/hash, invalid revision and extra target never reach native',
      () async {
    var calls = 0;
    for (final change in [
      {'sessionId': 'other'},
      {'text': 'changed'},
      {'textSha256': 'wrong'},
      {'revision': 0},
      {'targetLanguage': 'zh'}
    ]) {
      expect(
          await answerTextLanguageChallenge({...request, ...change}, 'session',
              (text) async {
            calls++;
            return observation;
          }),
          isNull);
    }
    expect(calls, 0);
  });
  test('native unavailable is unknown, never default Chinese', () async {
    final result = await answerTextLanguageChallenge(
        request, 'session', (text) async => throw MissingPluginException());
    expect(result!['dominant'], isNull);
    expect(result['hypotheses'], isEmpty);
  });
  test(
      'audio evidence echoes the exact sample range without turning it into language or billing authority',
      () async {
    const range = {'startSample': 0, 'endSample': 4096, 'sampleRate': 16000};
    final r = {...request, 'audioRange': range};
    final answer = await answerTextLanguageChallenge(
        r, 'session', (_) async => observation,
        speechObserve: (session, wanted) async {
      expect(session, 'session');
      expect(wanted, range);
      return {
        'method': deviceSpeechEvidenceMethod,
        'range': range,
        'decision': 'non_speech',
        'coveredThroughSample': 16000,
        'reason': 'render_echo'
      };
    });
    expect(answer!['audioEvidence'], isNotNull);
    expect(answer['evidence'], 'text_only_not_acoustic');
    expect(answer.containsKey('targetLanguage'), false);
    final stale = await answerTextLanguageChallenge(
        r, 'session', (_) async => observation,
        speechObserve: (_, __) async => {
              'method': deviceSpeechEvidenceMethod,
              'range': {...range, 'endSample': 5000},
              'decision': 'non_speech',
              'coveredThroughSample': 16000,
              'reason': 'render_echo'
            });
    expect(stale!.containsKey('audioEvidence'), false);
    final missing = await answerTextLanguageChallenge(
        r, 'session', (_) async => observation,
        speechObserve: (_, __) async => throw MissingPluginException());
    expect(missing!.containsKey('audioEvidence'), false);
    expect(
        await answerTextLanguageChallenge({
          ...r,
          'audioRange': {...range, 'startSample': true}
        }, 'session', (_) async => observation),
        isNull);
  });
  test(
      'public socket handles one challenge and tail after End; post-ended and old socket replies are discarded',
      () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    var calls = 0;
    Completer<Map<String, Object?>>? deferred;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('translation_mobile/text_language'),
            (call) async {
      calls++;
      return deferred == null ? observation : deferred.future;
    });
    final w = gateway.Wire();
    await w.setup();
    addTearDown(w.close);
    final connecting = w.client.connect(w.session()),
        peer = await w.peer.future;
    peer.add(jsonEncode({'type': 'session.started', 'sessionId': 'session'}));
    await connecting;
    peer.add(jsonEncode(request));
    peer.add(jsonEncode(request));
    await waitFor(
        () => w.frames.any((v) => v['type'] == 'text.language.result'));
    expect(calls, 1);
    expect(w.frames.single, fixture['response']);
    final ending =
        w.client.endAndWait('session', timeout: const Duration(seconds: 1));
    await waitFor(() => w.frames.any((v) => v['type'] == 'session.end'));
    peer.add(jsonEncode({...request, 'requestId': 'tail'}));
    await waitFor(() => w.frames.any((v) => v['requestId'] == 'tail'));
    deferred = Completer();
    peer.add(jsonEncode({...request, 'requestId': 'after'}));
    await waitFor(() => calls == 3);
    peer.add(jsonEncode({'type': 'session.ended', 'sessionId': 'session'}));
    await ending;
    deferred.complete(observation);
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(w.frames.any((v) => v['requestId'] == 'after'), false);
  });
  test('Android does not announce unimplemented Apple text language capability',
      () {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    expect(supportsDeviceTextLanguage, false);
  });
}

Future<void> waitFor(bool Function() predicate) async {
  final watch = Stopwatch()..start();
  while (!predicate()) {
    if (watch.elapsedMilliseconds > 1500) {
      fail('timed out waiting for real local socket event');
    }
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}
