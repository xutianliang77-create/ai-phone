import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/speech_capture_gate.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';
import 'helpers/realtime_controller_test_helpers.dart';

class PublicRepository extends FakeRealtimeRepository {
  final order = <String>[];
  bool public = true, boundaryAccepted = true;
  int captureSampleRate = 24000;
  Completer<bool>? boundary;
  @override
  Future<RealtimeSession> startSession() async {
    final original = await super.startSession();
    return RealtimeSession(
        sessionId: original.sessionId,
        realtimeToken: original.realtimeToken,
        endpoint: original.endpoint,
        expiresAt: original.expiresAt,
        maxDurationSeconds: 60,
        syncBinding: public
            ? ResultSyncBinding(
                deploymentId: 'public',
                ownerId: 'owner',
                modelPolicyRevision: 'p',
                captureSampleRate: captureSampleRate)
            : null);
  }

  @override
  bool sendAudio(String id, AudioFrame frame) {
    order.add('frame:${frame.sequence}');
    return super.sendAudio(id, frame);
  }

  @override
  Future<bool> commitAudioBoundary(String id) {
    order.add('boundary');
    return boundary?.future ?? Future.value(boundaryAccepted);
  }
}

class Capture extends FakeAudioCapture {
  final stream = StreamController<AudioFrame>.broadcast();
  bool tail = false;
  @override
  Stream<AudioFrame> get frames => stream.stream;
  void emit(int n, {bool endpoint = false}) => stream.add(AudioFrame(
      sequence: n,
      timestampMs: 1788883200000,
      sampleRate: 24000,
      bytes: List<int>.filled(4800, 0),
      endsSegment: endpoint));
  @override
  Future<void> stop() async {
    await super.stop();
    if (tail) {
      tail = false;
      emit(99, endpoint: true);
      await Future<void>.delayed(Duration.zero);
    }
  }

  @override
  Future<void> dispose() async {
    await stream.close();
    await super.dispose();
  }
}

void main() {
  test('public capture uses the declared 16k rate without changing the private default', () async {
    final repo = PublicRepository()..captureSampleRate = 16000, capture = Capture();
    final controller = realtimeControllerForTest(repo, capture);
    addTearDown(controller.disposeAsync);
    await controller.start();
    expect(capture.startedConfigs.single.sampleRate, 16000);
  });
  test('public JSON requires an explicit supported capture rate', () {
    final json = <String, Object?>{'deploymentId': 'public', 'ownerId': 'owner',
      'processing': {'contractVersion': 1, 'processingMode': 'online', 'modelPolicyRevision': 'p'}};
    for (final value in <Object?>[null, 8000, 16000.0, '16000']) {
      expect(() => ResultSyncBinding.fromJson({...json, 'captureSampleRate': value}), throwsFormatException);
    }
    for (final value in [16000, 24000]) {
      expect(ResultSyncBinding.fromJson({...json, 'captureSampleRate': value}).captureSampleRate, value);
    }
  });
  test(
      'public capture enables endpointing and sends the marked frame before its boundary',
      () async {
    final repo = PublicRepository(), capture = Capture();
    final controller = realtimeControllerForTest(repo, capture);
    addTearDown(controller.disposeAsync);
    await controller.start();
    expect(capture.startedConfigs.single.publicEndpointing, isTrue);
    expect(capture.startedConfigs.single.endpointOptions.keys,
        contains('vadThreshold'));
    capture.emit(1, endpoint: true);
    capture.emit(2);
    await pumpEventQueue();
    expect(repo.order, ['frame:1', 'boundary', 'frame:2']);
  });
  test('private capture retains old path and never sends endpoint control',
      () async {
    final repo = PublicRepository()..public = false, capture = Capture();
    final controller = realtimeControllerForTest(repo, capture);
    addTearDown(controller.disposeAsync);
    await controller.start();
    expect(capture.startedConfigs.single.publicEndpointing, isFalse);
    capture.emit(1, endpoint: true);
    await pumpEventQueue();
    expect(repo.order, ['frame:1']);
  });
  test('rejected endpoint fails closed without automatic retry', () async {
    final repo = PublicRepository()..boundaryAccepted = false,
        capture = Capture();
    final controller = realtimeControllerForTest(repo, capture);
    addTearDown(controller.disposeAsync);
    await controller.start();
    capture.emit(1, endpoint: true);
    await pumpEventQueue();
    expect(controller.status.name, 'failed');
    expect(repo.order.where((s) => s == 'boundary'), hasLength(1));
  });
  test(
      'stop forwards drained audio but leaves commit to the original end protocol',
      () async {
    final repo = PublicRepository(), capture = Capture();
    final controller = realtimeControllerForTest(repo, capture);
    addTearDown(controller.disposeAsync);
    await controller.start();
    capture.tail = true;
    await controller.stop();
    expect(repo.order, ['frame:99']);
  });
  test(
      'late endpoint rejection after stopping does not change the terminal state',
      () async {
    final repo = PublicRepository()..boundary = Completer<bool>(),
        capture = Capture();
    final controller = realtimeControllerForTest(repo, capture);
    addTearDown(controller.disposeAsync);
    await controller.start();
    capture.emit(1, endpoint: true);
    await pumpEventQueue();
    await controller.stop();
    repo.boundary!.complete(false);
    await pumpEventQueue();
    expect(controller.status.name, 'ended');
  });
  test('playback-only VAD endings do not create a future empty boundary',
      () async {
    var now = DateTime.utc(2026, 9, 9);
    final speechGate = SpeechCaptureGate(now: () => now);
    final repo = PublicRepository(), capture = Capture();
    final controller =
        realtimeControllerForTest(repo, capture, speechCaptureGate: speechGate);
    addTearDown(controller.disposeAsync);
    await controller.start();
    speechGate.beginPlayback(text: 'voice', language: 'en');
    capture.emit(1, endpoint: true);
    await pumpEventQueue();
    expect(repo.order, isEmpty);
    speechGate.endPlayback();
    now = now.add(const Duration(seconds: 1));
    capture.emit(2);
    await pumpEventQueue();
    expect(repo.order, ['frame:2']);
  });
}
