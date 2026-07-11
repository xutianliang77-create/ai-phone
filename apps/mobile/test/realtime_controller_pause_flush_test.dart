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
import 'package:translation_mobile/src/platform/audio/audio_capture.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';

void main() {
  test('accepts gateway flush events while pausing', () async {
    final repository = _PauseFlushRepository();
    final controller = RealtimeController(
      repository: repository,
      audioCapture: _NoopAudioCapture(),
      config: _config(),
    );
    addTearDown(controller.dispose);

    await controller.start();
    await controller.pause();

    expect(controller.status, RealtimeStatus.paused);
    expect(controller.segments.single.sourceText, 'tail before pause');
    expect(controller.segments.single.translatedText, '暂停前尾句');
  });
}

AppConfig _config() {
  return AppConfig(
    apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
    useMockAudio: false,
    useDeviceAsr: false,
    deviceAsrProvider: 'coreml_nemotron',
    deviceAsrLanguage: 'auto',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    serverOwnedHistory: true,
  );
}

class _PauseFlushRepository extends RealtimeRepository {
  _PauseFlushRepository()
      : super(
          apiClient: _NoopRealtimeApiClient(),
          gatewayClient: _NoopRealtimeGatewayClient(),
        );

  final _events = StreamController<GatewayRealtimeEvent>.broadcast();

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
  Future<bool> pauseAndWait(String sessionId) async {
    _events.add(GatewayRealtimeEvent(
      type: 'transcript.final',
      sessionId: sessionId,
      segmentId: 'tail_pause_1',
      text: 'tail before pause',
    ));
    _events.add(GatewayRealtimeEvent(
      type: 'translation.final',
      sessionId: sessionId,
      segmentId: 'tail_pause_1',
      text: '暂停前尾句',
      language: 'zh',
    ));
    await Future<void>.delayed(Duration.zero);
    return true;
  }

  @override
  Future<void> end(String sessionId, List<SubtitleSegment> segments) async {}

  @override
  void dispose() {
    unawaited(_events.close());
  }
}

class _NoopAudioCapture implements AudioCapture {
  @override
  Stream<AudioFrame> get frames => const Stream<AudioFrame>.empty();

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
  Future<void> dispose() async {}
}

class _NoopRealtimeApiClient extends RealtimeApiClient {
  _NoopRealtimeApiClient() : super(baseUrl: Uri.parse('http://127.0.0.1'));
}

class _NoopRealtimeGatewayClient extends RealtimeGatewayClient {}
