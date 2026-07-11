import 'dart:async';

import 'package:flutter/widgets.dart';
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
  test('does not resume an old session after lifecycle pause fails', () async {
    final repository = _FakeRealtimeRepository();
    final provider = _LifecycleAsrProvider(failStop: true);
    final controller = RealtimeController(
      repository: repository,
      audioCapture: _NoopAudioCapture(),
      mobileAsrProvider: provider,
      config: _deviceAsrConfig(),
    );
    addTearDown(controller.dispose);

    await controller.start();
    await controller.handleLifecycleState(AppLifecycleState.inactive);
    await pumpEventQueue();
    await controller.handleLifecycleState(AppLifecycleState.resumed);

    expect(controller.status, RealtimeStatus.ended);
    expect(repository.endedSessionIds, <String>['sess_1']);
    expect(repository.resumedSessionIds, isEmpty);
    expect(provider.startCalls, 1);
  });

  test('does not resume an ended session after lifecycle pause', () async {
    final repository = _FakeRealtimeRepository();
    final provider = _LifecycleAsrProvider();
    final controller = RealtimeController(
      repository: repository,
      audioCapture: _NoopAudioCapture(),
      mobileAsrProvider: provider,
      config: _deviceAsrConfig(),
    );
    addTearDown(controller.dispose);

    await controller.start();
    await controller.handleLifecycleState(AppLifecycleState.inactive);
    await controller.stop();
    await controller.handleLifecycleState(AppLifecycleState.resumed);

    expect(controller.status, RealtimeStatus.ended);
    expect(repository.endedSessionIds, <String>['sess_1']);
    expect(repository.resumedSessionIds, isEmpty);
    expect(provider.startCalls, 1);
  });
}

AppConfig _deviceAsrConfig() {
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

class _FakeRealtimeRepository extends RealtimeRepository {
  _FakeRealtimeRepository()
      : super(
          apiClient: _NoopRealtimeApiClient(),
          gatewayClient: _NoopRealtimeGatewayClient(),
        );

  final _events = StreamController<GatewayRealtimeEvent>.broadcast();
  final endedSessionIds = <String>[];
  final resumedSessionIds = <String>[];
  int closeRealtimeCalls = 0;

  @override
  Stream<GatewayRealtimeEvent> get events => _events.stream;

  @override
  Future<RealtimeSession> startSession() async {
    return RealtimeSession(
      sessionId: 'sess_1',
      realtimeToken: 'token',
      endpoint: Uri.parse('ws://127.0.0.1/realtime'),
      expiresAt: DateTime.now().add(const Duration(minutes: 5)),
      maxDurationSeconds: 60,
    );
  }

  @override
  bool pause(String sessionId) => true;

  @override
  Future<bool> pauseAndWait(String sessionId) async => pause(sessionId);

  @override
  bool resume(String sessionId) {
    resumedSessionIds.add(sessionId);
    return true;
  }

  @override
  Future<void> end(String sessionId, List<SubtitleSegment> segments) async {
    endedSessionIds.add(sessionId);
  }

  @override
  Future<void> closeRealtime() async {
    closeRealtimeCalls += 1;
  }

  @override
  void dispose() {
    unawaited(_events.close());
  }
}

class _LifecycleAsrProvider
    implements MobileAsrProvider, MobileAsrDiagnostics, MobileAsrPreparation {
  _LifecycleAsrProvider({this.failStop = false});

  final _segments = StreamController<AsrTextSegment>.broadcast();
  final bool failStop;
  int startCalls = 0;

  @override
  Stream<AsrTextSegment> get segments => _segments.stream;

  @override
  Future<MobileAsrAvailability> availability(MobileAsrConfig config) async {
    return const MobileAsrAvailability(
      canStart: true,
      reason: 'ready',
      message: 'Device ASR ready',
    );
  }

  @override
  Future<void> prepare(MobileAsrConfig config) async {}

  @override
  Future<void> requestPermission() async {}

  @override
  Future<void> start(MobileAsrConfig config) async {
    startCalls += 1;
  }

  @override
  Future<void> stop() async {
    if (failStop) throw StateError('device ASR stop failed');
  }

  @override
  Future<void> dispose() async {
    await _segments.close();
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
