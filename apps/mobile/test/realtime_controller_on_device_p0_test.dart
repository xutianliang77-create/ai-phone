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
  test('checks both local language packs before starting auto reverse',
      () async {
    final repository = _Repository();
    final translator = _DiagnosticTranslationProvider(available: true);
    final controller = _controller(repository, _AsrProvider(), translator);
    addTearDown(controller.dispose);

    await controller.start();

    expect(controller.status, RealtimeStatus.active);
    expect(
      translator.availabilityConfigs.map((config) {
        return '${config.sourceLanguage}->${config.targetLanguage}';
      }),
      <String>['en->zh', 'zh->en'],
    );
  });

  test('blocks local start when a translation language pack is missing',
      () async {
    final translator = _DiagnosticTranslationProvider(available: false);
    final controller = _controller(
      _Repository(),
      _AsrProvider(),
      translator,
    );
    addTearDown(controller.dispose);

    await controller.start();

    expect(controller.status, RealtimeStatus.failed);
    expect(
      controller.message,
      'On-device translation language pack is not installed',
    );
  });

  test('serializes local translations in ASR arrival order', () async {
    final repository = _Repository();
    final asr = _AsrProvider();
    final translator = _QueuedTranslationProvider();
    final controller = _controller(repository, asr, translator);
    addTearDown(controller.dispose);

    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_1',
      text: 'first',
      language: 'en',
    ));
    asr.emit(const AsrTextSegment(
      id: 'asr_2',
      text: 'second',
      language: 'en',
    ));
    await pumpEventQueue();

    expect(translator.startedTexts, <String>['first']);
    translator.completeNext('第一句');
    await pumpEventQueue();
    expect(translator.startedTexts, <String>['first', 'second']);
    translator.completeNext('第二句');
    await pumpEventQueue();

    expect(
      controller.segments.map((segment) => segment.translatedText),
      <String>['第一句', '第二句'],
    );
  });

  test('waits for an in-flight local translation before saving history',
      () async {
    final repository = _Repository();
    final asr = _AsrProvider();
    final translator = _QueuedTranslationProvider();
    final controller = _controller(repository, asr, translator);
    addTearDown(controller.dispose);

    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_1',
      text: 'hello',
      language: 'en',
    ));
    await pumpEventQueue();

    final stopping = controller.stop();
    await pumpEventQueue();
    expect(repository.endedSegments, isEmpty);

    translator.completeNext('你好');
    await stopping;

    expect(repository.endedSegments.single.sourceText, 'hello');
    expect(repository.endedSegments.single.translatedText, '你好');
  });
}

RealtimeController _controller(
  _Repository repository,
  _AsrProvider asr,
  MobileTranslationProvider translator,
) {
  return RealtimeController(
    repository: repository,
    audioCapture: _AudioCapture(),
    mobileAsrProvider: asr,
    mobileTranslationProvider: translator,
    config: AppConfig(
      apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
      useMockAudio: false,
      useDeviceAsr: true,
      useLocalSessions: true,
      useOnDeviceTranslation: true,
      deviceAsrProvider: 'coreml_nemotron',
      deviceAsrLanguage: 'auto',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 2240,
      autoReverseTargetLanguage: true,
      serverOwnedHistory: false,
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
  final endedSegments = <SubtitleSegment>[];

  @override
  Stream<GatewayRealtimeEvent> get events => _events.stream;

  @override
  Future<RealtimeSession> startSession() async {
    return RealtimeSession(
      sessionId: 'sess_1',
      realtimeToken: 'local',
      endpoint: Uri.parse('local://realtime'),
      expiresAt: DateTime.now().add(const Duration(minutes: 5)),
      maxDurationSeconds: 60,
    );
  }

  @override
  Future<void> end(String sessionId, List<SubtitleSegment> segments) async {
    endedSegments.addAll(segments);
  }

  @override
  void dispose() {
    unawaited(_events.close());
  }
}

class _AsrProvider implements MobileAsrProvider {
  final _segments = StreamController<AsrTextSegment>.broadcast();

  @override
  Stream<AsrTextSegment> get segments => _segments.stream;

  void emit(AsrTextSegment segment) => _segments.add(segment);

  @override
  Future<void> requestPermission() async {}

  @override
  Future<void> start(MobileAsrConfig config) async {}

  @override
  Future<void> stop() async {}

  @override
  Future<void> dispose() => _segments.close();
}

class _QueuedTranslationProvider implements MobileTranslationProvider {
  final startedTexts = <String>[];
  final _pending = <Completer<MobileTranslationResult?>>[];

  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) {
    startedTexts.add(text);
    final completer = Completer<MobileTranslationResult?>();
    _pending.add(completer);
    return completer.future;
  }

  void completeNext(String text) {
    _pending.removeAt(0).complete(
          MobileTranslationResult(text: text, provider: 'fake'),
        );
  }

  @override
  Future<void> dispose() async {}
}

class _DiagnosticTranslationProvider
    implements MobileTranslationProvider, MobileTranslationDiagnostics {
  _DiagnosticTranslationProvider({required this.available});

  final bool available;
  final availabilityConfigs = <MobileTranslationConfig>[];

  @override
  Future<MobileTranslationAvailability> availability(
    MobileTranslationConfig config,
  ) async {
    availabilityConfigs.add(config);
    return MobileTranslationAvailability(
      available: available,
      provider: 'fake',
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
      status: available ? 'installed' : 'supported',
      reason: available ? 'ready' : 'language_pair_not_installed',
    );
  }

  @override
  Future<MobileTranslationResult> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    return const MobileTranslationResult(
      text: 'translated',
      provider: 'fake',
    );
  }

  @override
  Future<void> dispose() async {}
}

class _AudioCapture implements AudioCapture {
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

class _ApiClient extends RealtimeApiClient {
  _ApiClient() : super(baseUrl: Uri.parse('http://127.0.0.1'));

  @override
  void close() {}
}

class _GatewayClient extends RealtimeGatewayClient {}
