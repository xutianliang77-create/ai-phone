import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/audio/audio_capture.dart';
import 'package:translation_mobile/src/platform/audio/ios_public_pcm_capture.dart';
import 'package:translation_mobile/src/platform/audio/record_audio_capture.dart';
import 'package:translation_mobile/src/platform/audio/online_audio_endpoint.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';

class _Detector implements AudioEndpointDetector {
  int samples = 0;
  bool stopped = false;
  @override
  Future<void> start(int rate,
      {Map<String, Object?> options = const {}}) async {}
  @override
  Future<bool> accept(AudioFrame frame) async {
    samples += frame.bytes.length ~/ 2;
    return false;
  }

  @override
  Future<void> stop() async {
    stopped = true;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const method = MethodChannel('translation_mobile/public_pcm_capture');
  const event = 'translation_mobile/public_pcm_capture/events';
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final calls = <MethodCall>[];
  late IosPublicPcmCapture input;
  late String captureId;
  var ready = true;
  var firstPcmReady = true;
  var sendStopTail = false;
  var failStop = false;
  setUp(() {
    calls.clear();
    ready = true;
    firstPcmReady = true;
    sendStopTail = false;
    failStop = false;
    input = IosPublicPcmCapture();
    messenger.setMockMethodCallHandler(const MethodChannel(event),
        (call) async {
      if (call.method == 'listen') {
        final id = (call.arguments as Map)['captureId'];
        scheduleMicrotask(() => messenger.handlePlatformMessage(
            event,
            const StandardMethodCodec()
                .encodeSuccessEnvelope({'captureId': id, 'ready': true}),
            (_) {}));
      }
      return null;
    });
    messenger.setMockMethodCallHandler(method, (call) async {
      calls.add(call);
      if (call.method == 'start') {
        final args = call.arguments as Map;
        captureId = args['captureId'] as String;
        return {
          'captureId': captureId,
          'sampleRate': args['sampleRate'],
          'voiceProcessingEnabled': ready,
          'sharedPlaybackReference': ready,
          'firstPcmReady': firstPcmReady,
          if (!ready) 'readiness': {'ready': false, 'reason': 'engine_not_running'},
        };
      }
      if (call.method == 'stop') {
        if (failStop) {
          throw PlatformException(code: 'public_capture_tail_unconfirmed');
        }
        final id = (call.arguments as Map)['captureId'];
        if (sendStopTail) {
          messenger.handlePlatformMessage(
              event,
              const StandardMethodCodec().encodeSuccessEnvelope({
                'captureId': id,
                'data': Uint8List.fromList([3, 0])
              }),
              (_) {});
        }
        scheduleMicrotask(() => messenger.handlePlatformMessage(
            event,
            const StandardMethodCodec()
                .encodeSuccessEnvelope({'captureId': id, 'stopped': true}),
            (_) {}));
      }
      return null;
    });
  });
  tearDown(() async {
    await input.stop();
    messenger.setMockMethodCallHandler(method, null);
    messenger.setMockMethodCallHandler(const MethodChannel(event), null);
  });
  Future<void> emit(String id) async {
    messenger.handlePlatformMessage(
        event,
        const StandardMethodCodec().encodeSuccessEnvelope({
          'captureId': id,
          'data': Uint8List.fromList([1, 0, 2, 0])
        }),
        (_) {});
    await pumpEventQueue();
  }

  test(
      'only public spoken iOS selects the shared reference; silent, private and Android retain their input',
      () {
    const spoken = AudioCaptureConfig(
        publicEndpointing: true, publicPlaybackReference: true);
    expect(usesIosPublicPlaybackCapture(spoken, TargetPlatform.iOS), isTrue);
    expect(
        usesIosPublicPlaybackCapture(spoken, TargetPlatform.android), isFalse);
    expect(
        usesIosPublicPlaybackCapture(
            const AudioCaptureConfig(publicEndpointing: true),
            TargetPlatform.iOS),
        isFalse);
    expect(
        usesIosPublicPlaybackCapture(
            const AudioCaptureConfig(publicPlaybackReference: true),
            TargetPlatform.iOS),
        isFalse);
  });
  for (final rate in [16000, 24000]) {
    test('negotiated $rate Hz PCM is forwarded, old generation is ignored',
        () async {
      final frames = <Uint8List>[], errors = <Object>[];
      await input.start(
          AudioCaptureConfig(sampleRate: rate), frames.add, errors.add);
      final old = captureId;
      await emit(captureId);
      await input.pause();
      await input.resume();
      await input.stop();
      await emit(old);
      await input.start(
          AudioCaptureConfig(sampleRate: rate), frames.add, errors.add);
      await emit(old);
      await emit(captureId);
      expect(frames.map((x) => x.toList()), [
        [1, 0, 2, 0],
        [1, 0, 2, 0]
      ]);
      expect(errors, isEmpty);
      expect(
          calls
              .where((x) => x.method == 'start')
              .map((x) => (x.arguments as Map)['sampleRate']),
          [rate, rate]);
      expect(calls.map((x) => x.method),
          containsAllInOrder(['start', 'pause', 'resume', 'stop', 'start']));
    });
  }
  test(
      'missing AEC/reference readiness fails rather than falling back to unprotected capture',
      () async {
    ready = false;
    await expectLater(input.start(const AudioCaptureConfig(), (_) {}, (_) {}),
        throwsA(isA<StateError>().having((e) => e.message, 'reason', contains('engine_not_running'))));
    expect(calls.map((x) => x.method), ['start', 'stop']);
  });
  test('engine flags without a first PCM acknowledgement do not report ready', () async {
    firstPcmReady = false;
    await expectLater(input.start(const AudioCaptureConfig(), (_) {}, (_) {}),throwsA(isA<StateError>()));
    expect(calls.map((c)=>c.method),['start','stop']);
  });
  test('first PCM arriving before the native ACK is retained until start completes', () async {
    final reply = Completer<Map<String,Object?>>(), frames = <Uint8List>[];
    messenger.setMockMethodCallHandler(method,(call) async {
      calls.add(call);
      final id=(call.arguments as Map)['captureId'] as String;
      if(call.method=='start') {
        captureId=id;
        messenger.handlePlatformMessage(event,const StandardMethodCodec().encodeSuccessEnvelope({
          'captureId':id,'data':Uint8List.fromList([1,0,2,0])}),(_){});
        return reply.future;
      }
      if(call.method=='stop')scheduleMicrotask(()=>messenger.handlePlatformMessage(event,
        const StandardMethodCodec().encodeSuccessEnvelope({'captureId':id,'stopped':true}),(_){}));
      return null;
    });
    final start=input.start(const AudioCaptureConfig(sampleRate:16000),frames.add,(_){});
    await pumpEventQueue();expect(frames,isEmpty);
    reply.complete({'captureId':captureId,'sampleRate':16000,'voiceProcessingEnabled':true,
      'sharedPlaybackReference':true,'firstPcmReady':true});
    await start;await pumpEventQueue();
    expect(frames.map((x)=>x.toList()),[[1,0,2,0]]);
  });
  test(
      'ordinary RecordAudioCapture forwards native PCM and drains its tail through unchanged VAD before stop',
      () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    final detector = _Detector(),
        capture = RecordAudioCapture(endpointDetector: detector);
    final frames = <AudioFrame>[];
    final sub = capture.frames.listen(frames.add);
    try {
      await capture.start(const AudioCaptureConfig(
          sampleRate: 16000,
          publicEndpointing: true,
          publicPlaybackReference: true));
      await emit(captureId);
      sendStopTail = true;
      await capture.stop();
      expect(frames.map((f) => f.bytes), [
        [1, 0, 2, 0],
        [3, 0]
      ]);
      expect(frames.map((f) => f.sequence), [1, 2]);
      expect(frames.map((f) => f.sampleRate), [16000, 16000]);
      expect(detector.samples, 3);
      expect(detector.stopped, isTrue);
      await emit(captureId);
      expect(frames.length, 2);
    } finally {
      await sub.cancel();
      await capture.dispose();
      debugDefaultTargetPlatformOverride = null;
    }
  });
  test('native stop failure is propagated after endpoint cleanup', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    final detector = _Detector(),
        capture = RecordAudioCapture(endpointDetector: detector);
    try {
      await capture.start(const AudioCaptureConfig(
          publicEndpointing: true, publicPlaybackReference: true));
      failStop = true;
      await expectLater(capture.stop(), throwsA(isA<PlatformException>()));
      expect(detector.stopped, isTrue);
    } finally {
      failStop = false;
      await capture.dispose();
      debugDefaultTargetPlatformOverride = null;
    }
  });
}
