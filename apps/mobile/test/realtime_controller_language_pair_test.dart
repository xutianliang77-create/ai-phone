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
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

void main() {
  test('reverses an explicit Chinese English pair in conversation mode',
      () async {
    final asr = _FakeMobileAsrProvider();
    final translator = _FakeTranslationProvider();
    final controller = _controller(
      asr,
      translator,
      sourceLanguage: 'zh',
      targetLanguage: 'en',
    );
    addTearDown(controller.dispose);

    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_zh',
      text: '你叫什么名字',
      language: 'auto',
    ));
    asr.emit(const AsrTextSegment(
      id: 'asr_en',
      text: 'what is your name',
      language: 'auto',
    ));
    await pumpEventQueue();

    expect(translator.directions, <String>['zh->en', 'en->zh']);
  });

  test('keeps an explicit target one-way in listening mode', () async {
    final asr = _FakeMobileAsrProvider();
    final translator = _FakeTranslationProvider();
    final controller = _controller(
      asr,
      translator,
      realtimeMode: 'meeting',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
    );
    addTearDown(controller.dispose);

    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_en',
      text: 'what is your name',
      language: 'auto',
    ));
    await pumpEventQueue();

    expect(translator.directions, isEmpty);
    expect(controller.segments.single.sourceText, 'what is your name');
    expect(controller.segments.single.translatedText, isEmpty);
  });
}

RealtimeController _controller(
  _FakeMobileAsrProvider asr,
  MobileTranslationProvider translator, {
  String realtimeMode = 'conversation',
  required String sourceLanguage,
  required String targetLanguage,
}) {
  return RealtimeController(
    repository: _FakeRealtimeRepository(),
    audioCapture: _NoopAudioCapture(),
    mobileAsrProvider: asr,
    mobileTranslationProvider: translator,
    config: AppConfig(
      apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
      useMockAudio: false,
      useDeviceAsr: true,
      realtimeMode: realtimeMode,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      useLocalSessions: true,
      useOnDeviceTranslation: true,
      deviceAsrProvider: 'coreml_nemotron',
      deviceAsrLanguage: 'auto',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 2240,
      autoReverseTargetLanguage: false,
      serverOwnedHistory: true,
    ),
  );
}

class _FakeRealtimeRepository extends RealtimeRepository {
  _FakeRealtimeRepository()
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
  Future<void> end(String sessionId, List<SubtitleSegment> segments) async {}

  @override
  void dispose() {
    unawaited(_events.close());
  }
}

class _FakeMobileAsrProvider implements MobileAsrProvider {
  final _segments = StreamController<AsrTextSegment>.broadcast();

  @override
  Stream<AsrTextSegment> get segments => _segments.stream;

  @override
  Future<void> requestPermission() async {}

  @override
  Future<void> start(MobileAsrConfig config) async {}

  @override
  Future<void> stop() async {}

  @override
  Future<void> dispose() async {
    await _segments.close();
  }

  void emit(AsrTextSegment segment) => _segments.add(segment);
}

class _FakeTranslationProvider implements MobileTranslationProvider {
  final directions = <String>[];

  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    directions.add('${config.sourceLanguage}->${config.targetLanguage}');
    return const MobileTranslationResult(text: 'translated', provider: 'fake');
  }

  @override
  Future<void> dispose() async {}
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
  _NoopRealtimeApiClient() : super(baseUrl: Uri.parse('http://localhost'));
}

class _NoopRealtimeGatewayClient extends RealtimeGatewayClient {}
