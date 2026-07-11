import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';
import 'package:translation_mobile/src/platform/audio/audio_session_coordinator.dart';

import 'helpers/fake_audio_session_coordinator.dart';
import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('restarts online capture after a resumable audio interruption',
      () async {
    final repository = FakeRealtimeRepository();
    final capture = FakeAudioCapture();
    final audioSession = FakeAudioSessionCoordinator();
    final controller = realtimeControllerForTest(
      repository,
      capture,
      audioSessionCoordinator: audioSession,
    );
    addTearDown(controller.dispose);
    await controller.start();

    audioSession.emit(const AudioSessionEvent(
      type: AudioSessionEventType.interruptionEnded,
      shouldResume: true,
    ));
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.active);
    expect(capture.stopCalls, 1);
    expect(capture.startCalls, 2);
    expect(audioSession.beginCaptureCalls, 2);
    expect(audioSession.endCaptureCalls, 1);
  });

  test('does not restart capture while the realtime session is paused',
      () async {
    final repository = FakeRealtimeRepository();
    final capture = FakeAudioCapture();
    final audioSession = FakeAudioSessionCoordinator();
    final controller = realtimeControllerForTest(
      repository,
      capture,
      audioSessionCoordinator: audioSession,
    );
    addTearDown(controller.dispose);
    await controller.start();
    await controller.pause();
    final startsBeforeInterruption = capture.startCalls;

    audioSession.emit(const AudioSessionEvent(
      type: AudioSessionEventType.interruptionEnded,
      shouldResume: true,
    ));
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.paused);
    expect(capture.startCalls, startsBeforeInterruption);
    expect(audioSession.beginCaptureCalls, 1);
    expect(audioSession.endCaptureCalls, 1);
  });

  test('reactivates the audio session before resuming online capture',
      () async {
    final operations = <String>[];
    final repository = _ResumeRealtimeRepository();
    final capture = _OrderedAudioCapture(operations);
    final audioSession = _OrderedAudioSessionCoordinator(operations);
    final controller = realtimeControllerForTest(
      repository,
      capture,
      audioSessionCoordinator: audioSession,
    );
    addTearDown(controller.dispose);

    await controller.start();
    await controller.pause();
    operations.clear();
    await controller.start();

    expect(controller.status, RealtimeStatus.active);
    expect(operations, <String>['session.begin', 'capture.resume']);
  });

  test('restarts device ASR after a resumable audio interruption', () async {
    final repository = FakeRealtimeRepository();
    final audioSession = FakeAudioSessionCoordinator();
    final asr = FakeMobileAsrProvider();
    final controller = RealtimeController(
      repository: repository,
      audioCapture: FakeAudioCapture(),
      mobileAsrProvider: asr,
      audioSessionCoordinator: audioSession,
      config: deviceAsrConfig(),
    );
    addTearDown(controller.dispose);
    await controller.start();

    audioSession.emit(const AudioSessionEvent(
      type: AudioSessionEventType.interruptionEnded,
      shouldResume: true,
    ));
    await Future<void>.delayed(const Duration(milliseconds: 140));
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.active);
    expect(asr.stopCalls, 1);
    expect(asr.startCalls, 2);
    expect(audioSession.beginCaptureCalls, 2);
    expect(audioSession.endCaptureCalls, 1);
  });

  test('parses native interruption and route events', () {
    expect(
      AudioSessionEvent.tryFromMap(const {
        'type': 'interruption.ended',
        'shouldResume': true,
      })?.shouldResume,
      isTrue,
    );
    expect(
      AudioSessionEvent.tryFromMap(const {
        'type': 'route.changed',
        'route': 'bluetooth',
      })?.route,
      AudioOutputRoute.bluetooth,
    );
    expect(AudioSessionEvent.tryFromMap(const {'type': 'unknown'}), isNull);
  });

  test('forwards capture ownership to the native coordinator', () async {
    const channel = MethodChannel('test/audio_session');
    final calls = <String>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      calls.add(call.method);
      return null;
    });
    addTearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
    });
    final coordinator = SystemAudioSessionCoordinator(
      methodChannel: channel,
      eventChannel: const EventChannel('test/audio_session/events'),
    );

    await coordinator.beginCapture();
    await coordinator.endCapture();

    expect(calls, ['beginCapture', 'endCapture']);
  });
}

class _OrderedAudioCapture extends FakeAudioCapture {
  _OrderedAudioCapture(this.operations);

  final List<String> operations;

  @override
  Future<void> resume() async {
    operations.add('capture.resume');
    await super.resume();
  }
}

class _ResumeRealtimeRepository extends FakeRealtimeRepository {
  @override
  Future<bool> resumeAndWait(String sessionId) async => true;
}

class _OrderedAudioSessionCoordinator extends FakeAudioSessionCoordinator {
  _OrderedAudioSessionCoordinator(this.operations);

  final List<String> operations;

  @override
  Future<void> beginCapture() async {
    operations.add('session.begin');
    await super.beginCapture();
  }
}

AppConfig deviceAsrConfig() {
  return AppConfig(
    apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
    useMockAudio: false,
    useDeviceAsr: true,
    deviceAsrProvider: 'coreml_nemotron',
    deviceAsrLanguage: 'auto',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    serverOwnedHistory: true,
  );
}

class FakeMobileAsrProvider implements MobileAsrProvider {
  final _segments = StreamController<AsrTextSegment>.broadcast();
  int startCalls = 0;
  int stopCalls = 0;

  @override
  Stream<AsrTextSegment> get segments => _segments.stream;

  @override
  Future<void> requestPermission() async {}

  @override
  Future<void> start(MobileAsrConfig config) async {
    startCalls += 1;
  }

  @override
  Future<void> stop() async {
    stopCalls += 1;
  }

  @override
  Future<void> dispose() => _segments.close();
}
