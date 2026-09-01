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

  test('preserves external program audio in meeting capture', () async {
    final repository = FakeRealtimeRepository();
    final capture = FakeAudioCapture();
    final audioSession = FakeAudioSessionCoordinator();
    final controller = realtimeControllerForTest(
      repository,
      capture,
      audioSessionCoordinator: audioSession,
      realtimeMode: 'meeting',
    );
    addTearDown(controller.dispose);

    await controller.start();

    expect(audioSession.voiceProcessingValues, <bool>[false]);
    expect(capture.startedConfigs.single.echoCancel, isFalse);
    expect(capture.startedConfigs.single.noiseSuppress, isFalse);
    expect(capture.startedConfigs.single.managePlatformAudioSession, isFalse);
  });

  test('keeps voice processing for conversation capture', () async {
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

    expect(audioSession.voiceProcessingValues, <bool>[true]);
    expect(capture.startedConfigs.single.echoCancel, isTrue);
    expect(capture.startedConfigs.single.noiseSuppress, isTrue);
    expect(capture.startedConfigs.single.managePlatformAudioSession, isFalse);
  });

  test('lets the recorder own the platform session without a coordinator',
      () async {
    final repository = FakeRealtimeRepository();
    final capture = FakeAudioCapture();
    final controller = realtimeControllerForTest(
      repository,
      capture,
      audioSessionCoordinator: const NoopAudioSessionCoordinator(),
    );
    addTearDown(controller.dispose);

    await controller.start();

    expect(capture.startedConfigs.single.managePlatformAudioSession, isTrue);
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

  test('recreates online capture instead of resuming a paused audio engine',
      () async {
    final repository = _ResumeRealtimeRepository();
    final capture = _RestartOnlyAudioCapture();
    final audioSession = FakeAudioSessionCoordinator();
    final controller = realtimeControllerForTest(
      repository,
      capture,
      audioSessionCoordinator: audioSession,
    );
    addTearDown(controller.dispose);

    await controller.start();
    await controller.pause();
    await controller.start();

    expect(controller.status, RealtimeStatus.active);
    expect(capture.startCalls, 2);
    expect(capture.stopCalls, 1);
    expect(audioSession.beginCaptureCalls, 2);
    expect(audioSession.endCaptureCalls, 1);
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
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
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

    await coordinator.beginCapture(voiceProcessing: false);
    await coordinator.endCapture();

    expect(calls.map((call) => call.method),
        <String>['beginCapture', 'endCapture']);
    expect(calls.first.arguments, <String, Object?>{
      'voiceProcessing': false,
    });
  });
}

class _RestartOnlyAudioCapture extends FakeAudioCapture {
  @override
  Future<void> pause() => throw StateError('pause must not be used');

  @override
  Future<void> resume() => throw StateError('resume must not be used');
}

class _ResumeRealtimeRepository extends FakeRealtimeRepository {
  @override
  Future<bool> resumeAndWait(String sessionId) async => true;
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
