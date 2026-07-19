import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';
import 'package:translation_mobile/src/platform/audio/audio_capture.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';

void main() {
  test('starts device ASR and sends ASR text segments to Gateway', () async {
    final repository = _FakeRealtimeRepository();
    final provider = _FakeMobileAsrProvider();
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();
    provider.emit(const AsrTextSegment(
      id: 'asr_1',
      text: 'hello',
      language: 'en',
      isFinal: true,
      confidence: 0.9,
    ));
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.active);
    expect(provider.calls, <String>[
      'availability',
      'prepare',
      'requestPermission',
      'start',
    ]);
    expect(repository.startedSessionIds, <String>['sess_1']);
    expect(repository.sentTextSegments.single.sessionId, 'sess_1');
    expect(repository.sentTextSegments.single.segment.text, 'hello');
  });

  test('pauses and resumes device ASR without new session', () async {
    final repository = _FakeRealtimeRepository();
    final provider = _FakeMobileAsrProvider(
      onStopSegment: const AsrTextSegment(
        id: 'pause_tail_1',
        text: 'pause tail',
        language: 'en',
        isFinal: true,
      ),
    );
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();
    await controller.pause();
    expect(repository.sentTextSegments.single.segment.id, 'pause_tail_1');
    await controller.start();

    expect(controller.status, RealtimeStatus.active);
    expect(repository.startedSessionIds, <String>['sess_1']);
    expect(repository.pausedSessionIds, <String>['sess_1']);
    expect(repository.resumedSessionIds, <String>['sess_1']);
    expect(provider.startCalls, 2);
    expect(provider.stopCalls, 1);
  });

  test('ends session when device ASR pause fails', () async {
    final repository = _FakeRealtimeRepository();
    final provider = _FakeMobileAsrProvider(failStop: true);
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();
    await controller.pause();
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.failed);
    expect(controller.message, contains('device ASR stop failed'));
    expect(repository.pausedSessionIds, isEmpty);
    expect(repository.endedSessionIds, <String>['sess_1']);
    expect(repository.closeRealtimeCalls, 1);
    expect(provider.stopCalls, 2);
  });

  test('ends session when device ASR resume fails', () async {
    final repository = _FakeRealtimeRepository();
    final provider = _FakeMobileAsrProvider(failResumeStart: true);
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();
    await controller.pause();
    await controller.start();
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.failed);
    expect(controller.message, contains('device ASR start failed'));
    expect(repository.startedSessionIds, <String>['sess_1']);
    expect(repository.pausedSessionIds, <String>['sess_1']);
    expect(repository.resumedSessionIds, <String>['sess_1']);
    expect(repository.endedSessionIds, <String>['sess_1']);
    expect(repository.closeRealtimeCalls, 1);
    expect(provider.startCalls, 2);
  });

  test('sends final ASR text emitted just after native stop returns', () async {
    final repository = _FakeRealtimeRepository();
    final provider = _FakeMobileAsrProvider(
      onStopSegment: const AsrTextSegment(
        id: 'tail_1',
        text: 'final tail',
        language: 'en',
        isFinal: true,
      ),
    );
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();
    await controller.stop();

    expect(controller.status, RealtimeStatus.ended);
    expect(repository.sentTextSegments.single.segment.id, 'tail_1');
    expect(repository.endedSessionIds, <String>['sess_1']);
  });

  test('ends created session when device ASR start fails', () async {
    final repository = _FakeRealtimeRepository();
    final provider = _FakeMobileAsrProvider(failStart: true, failStop: true);
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.failed);
    expect(controller.message, contains('device ASR start failed'));
    expect(repository.startedSessionIds, <String>['sess_1']);
    expect(repository.endedSessionIds, <String>['sess_1']);
    expect(repository.closeRealtimeCalls, 1);
    expect(provider.startCalls, 2);
    expect(provider.stopCalls, 2);
  });
}

RealtimeController _controller(
  _FakeRealtimeRepository repository,
  _FakeMobileAsrProvider provider,
) {
  return RealtimeController(
    repository: repository,
    audioCapture: _NoopAudioCapture(),
    mobileAsrProvider: provider,
    config: AppConfig(
      apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
      useMockAudio: false,
      useDeviceAsr: true,
      deviceAsrProvider: 'coreml_nemotron',
      deviceAsrLanguage: 'auto',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 2240,
      serverOwnedHistory: true,
    ),
  );
}

class _SentTextSegment {
  const _SentTextSegment(this.sessionId, this.segment);

  final String sessionId;
  final AsrTextSegment segment;
}

class _FakeRealtimeRepository extends RealtimeRepository {
  _FakeRealtimeRepository()
      : super(
          apiClient: _NoopRealtimeApiClient(),
          gatewayClient: _NoopRealtimeGatewayClient(),
        );

  final _events = StreamController<GatewayRealtimeEvent>.broadcast();
  final startedSessionIds = <String>[];
  final pausedSessionIds = <String>[];
  final resumedSessionIds = <String>[];
  final endedSessionIds = <String>[];
  final sentTextSegments = <_SentTextSegment>[];
  int closeRealtimeCalls = 0;

  @override
  Stream<GatewayRealtimeEvent> get events => _events.stream;

  @override
  Future<RealtimeSession> startSession() async {
    final sessionId = 'sess_${startedSessionIds.length + 1}';
    startedSessionIds.add(sessionId);
    return RealtimeSession(
      sessionId: sessionId,
      realtimeToken: 'token',
      endpoint: Uri.parse('ws://127.0.0.1/realtime'),
      expiresAt: DateTime.now().add(const Duration(minutes: 5)),
      maxDurationSeconds: 60,
    );
  }
  @override
  bool sendTextSegment(String sessionId, AsrTextSegment segment) {
    sentTextSegments.add(_SentTextSegment(sessionId, segment));
    return true;
  }

  @override
  bool pause(String sessionId) {
    pausedSessionIds.add(sessionId);
    return true;
  }

  @override
  Future<bool> pauseAndWait(String sessionId) async => pause(sessionId);
  @override
  bool resume(String sessionId) {
    resumedSessionIds.add(sessionId);
    return true;
  }
  @override
  Future<bool> resumeAndWait(String sessionId) async => resume(sessionId);

  @override
  Future<void> end(String sessionId, List<SubtitleSegment> segments) async =>
      endedSessionIds.add(sessionId);

  @override
  Future<void> closeRealtime() async => closeRealtimeCalls += 1;

  @override
  void dispose() => unawaited(_events.close());
}

class _FakeMobileAsrProvider
    implements MobileAsrProvider, MobileAsrDiagnostics, MobileAsrPreparation {
  _FakeMobileAsrProvider({
    this.onStopSegment,
    this.failStart = false,
    this.failResumeStart = false,
    this.failStop = false,
  });

  final AsrTextSegment? onStopSegment;
  final bool failStart;
  final bool failResumeStart;
  final bool failStop;
  final _segments = StreamController<AsrTextSegment>.broadcast();
  final calls = <String>[];
  int startCalls = 0;
  int stopCalls = 0;

  @override
  Stream<AsrTextSegment> get segments => _segments.stream;

  @override
  Future<MobileAsrAvailability> availability(MobileAsrConfig config) async {
    calls.add('availability');
    return const MobileAsrAvailability(
      canStart: true,
      reason: 'ready',
      message: 'Device ASR ready',
    );
  }

  @override
  Future<void> prepare(MobileAsrConfig config) async {
    calls.add('prepare');
  }

  @override
  Future<void> requestPermission() async {
    calls.add('requestPermission');
  }

  @override
  Future<void> start(MobileAsrConfig config) async {
    calls.add('start');
    startCalls += 1;
    if (failStart || (failResumeStart && startCalls > 1)) {
      throw StateError('device ASR start failed');
    }
  }

  @override
  Future<void> stop() async {
    calls.add('stop');
    stopCalls += 1;
    if (failStop) throw StateError('device ASR stop failed');
    final segment = onStopSegment;
    if (segment != null) {
      Timer(const Duration(milliseconds: 10), () {
        if (!_segments.isClosed) _segments.add(segment);
      });
    }
  }

  @override
  Future<void> dispose() async {
    await _segments.close();
  }

  void emit(AsrTextSegment segment) {
    _segments.add(segment);
  }
}

class _NoopAudioCapture implements AudioCapture {
  final _frames = StreamController<AudioFrame>.broadcast();

  @override
  Stream<AudioFrame> get frames => _frames.stream;

  @override
  Future<void> requestPermission() async {}

  @override
  Future<void> start(AudioCaptureConfig config) async {}

  @override
  Future<void> pause() async {}

  @override
  Future<void> resume() async {}

  @override
  Future<void> stop() async {}

  @override
  Future<void> dispose() async {
    await _frames.close();
  }
}

class _NoopRealtimeApiClient extends RealtimeApiClient {
  _NoopRealtimeApiClient() : super(baseUrl: Uri.parse('http://127.0.0.1'));

  @override
  void close() {}
}

class _NoopRealtimeGatewayClient extends RealtimeGatewayClient {}
