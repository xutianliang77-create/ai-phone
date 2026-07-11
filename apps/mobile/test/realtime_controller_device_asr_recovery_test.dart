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
  test('retries device ASR once when initial native start fails', () async {
    final repository = _Repository();
    final provider = _AsrProvider(failFirstStart: true);
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();

    expect(controller.status, RealtimeStatus.listening);
    expect(controller.message, isNull);
    expect(provider.startCalls, 2);
    expect(provider.stopCalls, 1);
    expect(repository.endedSessionIds, isEmpty);
    expect(repository.closeRealtimeCalls, 0);
  });

  test('restarts device ASR once after early runtime stream error', () async {
    final repository = _Repository();
    final provider = _AsrProvider();
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();
    provider.emitError(StateError('native warm-up failed'));
    await _settleAsrRecovery();

    expect(controller.status, RealtimeStatus.listening);
    expect(controller.message, isNull);
    expect(provider.startCalls, 2);
    expect(provider.stopCalls, 1);
    expect(repository.endedSessionIds, isEmpty);
    expect(repository.closeRealtimeCalls, 0);
  });

  test('ends session when early device ASR restart also fails', () async {
    final repository = _Repository();
    final provider = _AsrProvider(failSecondStart: true);
    final controller = _controller(repository, provider);
    addTearDown(controller.dispose);

    await controller.start();
    provider.emitError(StateError('native warm-up failed'));
    await _settleAsrRecovery();

    expect(controller.status, RealtimeStatus.ended);
    expect(controller.message, contains('device ASR start failed'));
    expect(provider.startCalls, 2);
    expect(repository.endedSessionIds, <String>['sess_1']);
    expect(repository.closeRealtimeCalls, 1);
  });
}

Future<void> _settleAsrRecovery() async {
  await Future<void>.delayed(const Duration(milliseconds: 180));
  await pumpEventQueue();
}

RealtimeController _controller(_Repository repository, _AsrProvider provider) {
  return RealtimeController(
    repository: repository,
    audioCapture: _AudioCapture(),
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

class _Repository extends RealtimeRepository {
  _Repository()
      : super(
          apiClient: _ApiClient(),
          gatewayClient: _GatewayClient(),
        );

  final _events = StreamController<GatewayRealtimeEvent>.broadcast();
  final endedSessionIds = <String>[];
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

class _AsrProvider
    implements MobileAsrProvider, MobileAsrDiagnostics, MobileAsrPreparation {
  _AsrProvider({this.failFirstStart = false, this.failSecondStart = false});

  final bool failFirstStart;
  final bool failSecondStart;
  final _segments = StreamController<AsrTextSegment>.broadcast();
  int startCalls = 0;
  int stopCalls = 0;

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
    if (failFirstStart && startCalls == 1) {
      throw StateError('device ASR first start failed');
    }
    if (failSecondStart && startCalls == 2) {
      throw StateError('device ASR start failed');
    }
  }

  @override
  Future<void> stop() async {
    stopCalls += 1;
  }

  @override
  Future<void> dispose() async {
    await _segments.close();
  }

  void emitError(Object error) {
    _segments.addError(error);
  }
}

class _AudioCapture implements AudioCapture {
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

class _ApiClient extends RealtimeApiClient {
  _ApiClient() : super(baseUrl: Uri.parse('http://127.0.0.1'));

  @override
  void close() {}
}

class _GatewayClient extends RealtimeGatewayClient {}
