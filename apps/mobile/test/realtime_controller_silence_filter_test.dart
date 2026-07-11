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
  test('ignores ASR silence markers before local translation', () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final translator = _FakeTranslationProvider();
    final controller = RealtimeController(
      repository: repository,
      audioCapture: _NoopAudioCapture(),
      mobileAsrProvider: asr,
      mobileTranslationProvider: translator,
      config: _config(),
    );
    addTearDown(controller.dispose);

    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_sil',
      text: '<sil>',
      language: 'auto',
      isFinal: true,
    ));
    await pumpEventQueue();

    expect(translator.translateCalls, 0);
    expect(repository.sentTextSegments, isEmpty);
    expect(controller.segments, isEmpty);
  });

  test('strips ASR silence markers before local translation', () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final translator = _FakeTranslationProvider();
    final controller = RealtimeController(
      repository: repository,
      audioCapture: _NoopAudioCapture(),
      mobileAsrProvider: asr,
      mobileTranslationProvider: translator,
      config: _config(),
    );
    addTearDown(controller.dispose);

    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_mix',
      text: 'hello <|nospeech|> world',
      language: 'en',
      isFinal: true,
    ));
    await pumpEventQueue();

    expect(translator.translateCalls, 1);
    expect(translator.lastText, 'hello world');
    expect(controller.segments.single.sourceText, 'hello world');
    expect(controller.segments.single.translatedText, 'ignored');
  });

  test('strips ASR silence markers before sending online text segment',
      () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final controller = RealtimeController(
      repository: repository,
      audioCapture: _NoopAudioCapture(),
      mobileAsrProvider: asr,
      config: _config(
        useLocalSessions: false,
        useOnDeviceTranslation: false,
      ),
    );
    addTearDown(controller.dispose);

    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_online_mix',
      text: '你好 <sil> 测试',
      language: 'zh',
      isFinal: true,
    ));
    await pumpEventQueue();

    expect(repository.sentTextSegments.single.text, '你好 测试');
  });
}

AppConfig _config({
  bool useLocalSessions = true,
  bool useOnDeviceTranslation = true,
}) {
  return AppConfig(
    apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
    useMockAudio: false,
    useDeviceAsr: true,
    useLocalSessions: useLocalSessions,
    useOnDeviceTranslation: useOnDeviceTranslation,
    deviceAsrProvider: 'coreml_nemotron',
    deviceAsrLanguage: 'auto',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    autoReverseTargetLanguage: true,
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
  final sentTextSegments = <AsrTextSegment>[];

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
  bool sendTextSegment(String sessionId, AsrTextSegment segment) {
    sentTextSegments.add(segment);
    return true;
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

  void emit(AsrTextSegment segment) {
    _segments.add(segment);
  }
}

class _FakeTranslationProvider implements MobileTranslationProvider {
  var translateCalls = 0;
  String? lastText;

  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    translateCalls += 1;
    lastText = text;
    return const MobileTranslationResult(text: 'ignored', provider: 'fake');
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
  _NoopRealtimeApiClient() : super(baseUrl: Uri.parse('http://127.0.0.1'));
}

class _NoopRealtimeGatewayClient extends RealtimeGatewayClient {}
