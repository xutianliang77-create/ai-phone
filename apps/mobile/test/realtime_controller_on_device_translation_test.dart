import 'dart:async';
import 'dart:io';

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
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/realtime/data/local_realtime_repository.dart';
import 'helpers/fake_speech_output_provider.dart';

part 'helpers/realtime_on_device_translation_fakes.dart';
part 'helpers/realtime_device_language_cases.dart';
part 'helpers/realtime_translation_failure_cases.dart';
part 'helpers/realtime_local_rule_cases.dart';
part 'helpers/realtime_hypothesis_cases.dart';
part 'helpers/realtime_checkpoint_cases.dart';

void main() {
  deviceLanguageCases();
  translationFailureCases();
  localRuleCases();
  hypothesisCases();
  checkpointCases();
  test('uses on-device translation before Gateway for final ASR text',
      () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final translator = _FakeTranslationProvider('你好');
    final controller = _controller(repository, asr, translator);
    addTearDown(controller.dispose);
    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_1',
      text: 'hello',
      language: 'en',
      isFinal: true,
    ));
    await pumpEventQueue();

    expect(repository.sentTextSegments, isEmpty);
    expect(controller.segments.single.sourceText, 'hello');
    expect(controller.segments.single.translatedText, '你好');
    await controller.stop();
    expect(repository.endedSegments.single.translatedText, '你好');
  });
  test('falls back to Gateway when local translation has no result', () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final controller = _controller(
      repository,
      asr,
      _FakeTranslationProvider(null),
    );
    addTearDown(controller.dispose);
    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_1',
      text: 'unmapped',
      language: 'en',
      isFinal: true,
    ));
    await pumpEventQueue();

    expect(repository.sentTextSegments.single.text, 'unmapped');
    expect(controller.segments, isEmpty);
  });
  test('keeps source text locally when local translation has no result',
      () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final controller = _controller(
      repository,
      asr,
      _FakeTranslationProvider(null),
      useLocalSessions: true,
    );
    addTearDown(controller.dispose);
    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_1',
      text: 'unmapped',
      language: 'en',
      isFinal: true,
    ));
    await pumpEventQueue();

    expect(repository.sentTextSegments, isEmpty);
    expect(controller.segments.single.sourceText, 'unmapped');
    expect(controller.segments.single.translatedText, isEmpty);
  });

  test('keeps partial ASR text locally without Gateway', () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final controller = _controller(
      repository,
      asr,
      _FakeTranslationProvider(null),
      useLocalSessions: true,
    );
    addTearDown(controller.dispose);
    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_1',
      text: 'hello wor',
      language: 'en',
      isFinal: false,
    ));
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.active);
    expect(repository.sentTextSegments, isEmpty);
    expect(controller.segments.single.sourceText, 'hello wor');
    expect(controller.segments.single.translatedText, isEmpty);
  });

  test('does not translate or speak partial ASR text before native final',
      () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final controller = _controller(
      repository,
      asr,
      _FakeTranslationProvider('你好'),
      useLocalSessions: true,
    );
    addTearDown(controller.dispose);
    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_1',
      text: 'hello',
      language: 'en',
      isFinal: false,
    ));
    await Future<void>.delayed(const Duration(milliseconds: 1700));
    await pumpEventQueue();

    expect(repository.sentTextSegments, isEmpty);
    expect(controller.segments.single.sourceText, 'hello');
    expect(controller.segments.single.translatedText, isEmpty);
  });

  test('flushes pending local partial before saving history on stop', () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final controller = _controller(
      repository,
      asr,
      _FakeTranslationProvider('你好'),
      useLocalSessions: true,
    );
    addTearDown(controller.dispose);
    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_1',
      text: 'hello',
      language: 'en',
      isFinal: false,
    ));
    await pumpEventQueue();

    await controller.stop();

    expect(repository.sentTextSegments, isEmpty);
    expect(repository.endedSegments.single.sourceText, 'hello');
    expect(repository.endedSegments.single.translatedText, '你好');
  });

  test('switches local direction from ASR text language', () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final translator = _FakeTranslationProvider('translated');
    final controller =
        _controller(repository, asr, translator, useLocalSessions: true);
    addTearDown(controller.dispose);
    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_zh',
      text: '今天测试',
      language: 'auto',
    ));
    asr.emit(const AsrTextSegment(
      id: 'asr_en',
      text: 'hello',
      language: 'auto',
    ));
    asr.emit(const AsrTextSegment(
      id: 'asr_mix',
      text: 'hello 你好',
      language: 'auto',
    ));
    await pumpEventQueue();

    expect(translator.configs.map((config) {
      return '${config.sourceLanguage}->${config.targetLanguage}';
    }), <String>['zh->en', 'en->zh', 'en->zh']);
  });
}

RealtimeController _controller(
  _FakeRealtimeRepository repository,
  _FakeMobileAsrProvider asr,
  MobileTranslationProvider translator, {
  bool useLocalSessions = false,
  String sourceLanguage = 'auto',
  String targetLanguage = 'zh',
}) {
  return RealtimeController(
    repository: repository,
    audioCapture: _NoopAudioCapture(),
    mobileAsrProvider: asr,
    mobileTranslationProvider: translator,
    config: AppConfig(
      apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
      useMockAudio: false,
      useDeviceAsr: true,
      useLocalSessions: useLocalSessions,
      useOnDeviceTranslation: true,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      deviceAsrProvider: 'coreml_nemotron',
      deviceAsrLanguage: 'auto',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 2240,
      autoReverseTargetLanguage: true,
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
  final sentTextSegments = <AsrTextSegment>[];
  final endedSegments = <SubtitleSegment>[];

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
  Future<void> end(String sessionId, List<SubtitleSegment> segments) async {
    endedSegments.addAll(segments);
  }

  @override
  void dispose() {
    unawaited(_events.close());
  }
}

class _FakeMobileAsrProvider implements MobileAsrProvider {
  MobileAsrConfig? lastConfig;
  final _segments = StreamController<AsrTextSegment>.broadcast();

  @override
  Stream<AsrTextSegment> get segments => _segments.stream;

  @override
  Future<void> requestPermission() async {}

  @override
  Future<void> start(MobileAsrConfig config) async {
    lastConfig = config;
  }

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
  _FakeTranslationProvider(this.text);

  final String? text;
  final configs = <MobileTranslationConfig>[];

  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    configs.add(config);
    final translated = this.text;
    if (translated == null) return null;
    final markers =
        RegExp(r'XTLKEEP\d+QXZ').allMatches(text).map((m) => m[0]).join(' ');
    return MobileTranslationResult(
      text: '$translated $markers'.trim(),
      provider: 'fake',
    );
  }

  @override
  Future<void> dispose() async {}
}
