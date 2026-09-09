import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';
import 'package:translation_mobile/src/platform/audio/online_audio_endpoint.dart';

class Detector implements AudioEndpointDetector {
  final inputs = <int>[];
  int stops = 0;
  Future<bool> Function(AudioFrame)? run;
  @override
  Future<void> start(int rate,
      {Map<String, Object?> options = const {}}) async {}
  @override
  Future<bool> accept(AudioFrame frame) async {
    inputs.add(frame.sequence);
    return run == null ? frame.sequence == 2 : await run!(frame);
  }

  @override
  Future<void> stop() async {
    stops++;
  }
}

AudioFrame frame(int n, {int samples = 960}) => AudioFrame(
    sequence: n,
    timestampMs: 1788883200000 + n,
    sampleRate: 24000,
    bytes: List<int>.filled(samples * 2, n));
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('translation_mobile/apple_speech_asr');
  tearDown(() => TestDefaultBinaryMessengerBinding
      .instance.defaultBinaryMessenger
      .setMockMethodCallHandler(channel, null));
  test(
      'native VAD uses existing channel only, preserves options and validates frame ACK',
      () async {
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      final args = call.arguments as Map;
      if (call.method == 'endpoint.start') {
        return {
          'requestId': args['requestId'],
          'ready': true,
          'provider': 'fluidaudio_silero'
        };
      }
      if (call.method == 'endpoint.process') {
        expect(args['pcm'], isA<Uint8List>());
        return {
          'requestId': args['requestId'],
          'sequence': args['sequence'],
          'boundary': true
        };
      }
      return null;
    });
    final detector = IosAudioEndpointDetector();
    await detector.start(24000,
        options: {'endpointSilenceMs': 640, 'vadThreshold': 0.65});
    expect((calls.first.arguments as Map)['vadThreshold'], 0.65);
    expect(await detector.accept(frame(1)), isTrue);
    await detector.stop();
    expect(calls.map((c) => c.method),
        ['endpoint.start', 'endpoint.process', 'endpoint.stop']);
  });
  test('native response cannot cross sequence or request scope', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      final args = call.arguments as Map;
      if (call.method == 'endpoint.start') {
        return {
          'requestId': args['requestId'],
          'ready': true,
          'provider': 'fluidaudio_silero'
        };
      }
      if (call.method == 'endpoint.process') {
        return {
          'requestId': 'other',
          'sequence': args['sequence'],
          'boundary': true
        };
      }
      return null;
    });
    final detector = IosAudioEndpointDetector();
    await detector.start(24000);
    await expectLater(detector.accept(frame(1)), throwsStateError);
    await detector.stop();
  });
  test('missing Silero never becomes RMS or a model download', () async {
    final methods = <String>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      methods.add(call.method);
      final args = call.arguments as Map;
      if (call.method == 'endpoint.start') {
        return {
          'requestId': args['requestId'],
          'ready': true,
          'provider': 'rms'
        };
      }
      return null;
    });
    await expectLater(
        IosAudioEndpointDetector().start(24000), throwsStateError);
    await pumpEventQueue();
    expect(methods, ['endpoint.start', 'endpoint.stop']);
  });
  test(
      'ordered analysis preserves exact PCM and attaches endpoint to its own frame',
      () async {
    final detector = Detector(), frames = <AudioFrame>[], errors = <Object>[];
    final processor =
        OnlineAudioEndpointProcessor(detector, frames.add, errors.add);
    await processor.start(24000);
    final a = frame(1), b = frame(2);
    processor.add(a);
    processor.add(b);
    await processor.stop();
    expect(detector.inputs, [1, 2]);
    expect(frames.map((e) => e.endsSegment), [false, true]);
    expect(frames[0].bytes, a.bytes);
    expect(frames[1].timestampMs, b.timestampMs);
    expect(errors, isEmpty);
  });
  test('normal stop drains accepted frames but rejects later frames', () async {
    final gate = Completer<bool>(),
        detector = Detector(),
        frames = <AudioFrame>[];
    detector.run = (_) => gate.future;
    final p = OnlineAudioEndpointProcessor(detector, frames.add, (_) {});
    await p.start(24000);
    p.add(frame(1));
    await pumpEventQueue();
    final stopping = p.stop();
    p.add(frame(2));
    gate.complete(true);
    await stopping;
    expect(frames.map((f) => f.sequence), [1]);
    expect(detector.stops, 1);
  });
  test('cancel discards a late native decision', () async {
    final gate = Completer<bool>(),
        detector = Detector(),
        frames = <AudioFrame>[];
    detector.run = (_) => gate.future;
    final p = OnlineAudioEndpointProcessor(detector, frames.add, (_) {});
    await p.start(24000);
    p.add(frame(1));
    await pumpEventQueue();
    await p.stop(drain: false);
    gate.complete(true);
    await pumpEventQueue();
    expect(frames, isEmpty);
  });
  test('queue overflow fails once instead of dropping or replaying PCM',
      () async {
    final gate = Completer<bool>(),
        detector = Detector(),
        errors = <Object>[],
        frames = <AudioFrame>[];
    detector.run = (_) => gate.future;
    final p = OnlineAudioEndpointProcessor(detector, frames.add, errors.add);
    await p.start(24000);
    p.add(frame(1, samples: 24000));
    p.add(frame(2, samples: 24000));
    p.add(frame(3, samples: 24000));
    expect(errors, hasLength(1));
    gate.complete(false);
    await expectLater(p.stop(), throwsStateError);
    expect(frames, isEmpty);
  });
  test('continuous audio forces a boundary below Gateway 30-second limit',
      () async {
    final detector = Detector()..run = (_) async => false,
        frames = <AudioFrame>[];
    final p = OnlineAudioEndpointProcessor(detector, frames.add, (_) {});
    await p.start(24000);
    for (var n = 1; n <= 29; n++) {
      p.add(frame(n, samples: 24000));
      await pumpEventQueue();
    }
    await p.stop();
    expect(frames.where((f) => f.endsSegment).map((f) => f.sequence), [28]);
    expect(frames, hasLength(29));
  });
  test('native failure does not emit an unverified frame', () async {
    final detector = Detector()..run = (_) async => throw StateError('failure'),
        frames = <AudioFrame>[],
        errors = <Object>[];
    final p = OnlineAudioEndpointProcessor(detector, frames.add, errors.add);
    await p.start(24000);
    p.add(frame(1));
    await expectLater(p.stop(), throwsStateError);
    expect(errors, hasLength(1));
    expect(frames, isEmpty);
  });
}
