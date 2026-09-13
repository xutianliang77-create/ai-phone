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
import 'package:translation_mobile/src/platform/speech/pcm_audio_output_player.dart';
import 'package:translation_mobile/src/platform/speech/speech_output_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';
import 'package:translation_mobile/src/platform/translation/translation_language_pair.dart';

import 'helpers/fake_pcm_audio_output_player.dart';
import 'helpers/fake_speech_output_provider.dart';

part 'helpers/realtime_speech_fakes.dart';
part 'helpers/realtime_speech_stop_case.dart';
part 'helpers/realtime_device_revision_cases.dart';
part 'helpers/realtime_voice_route_cases.dart';
part 'helpers/realtime_speech_queue_cases.dart';

void main() {
  registerVoiceRouteCases();
  registerSpeechQueueCases();
  registerSpeechStopDrainTest();
  registerDeviceRevisionCases();
  test('speaks final translated text when auto speech is enabled', () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final speaker = FakeSpeechOutputProvider();
    final controller = RealtimeController(
      repository: repository,
      audioCapture: _NoopAudioCapture(),
      mobileAsrProvider: asr,
      mobileTranslationProvider: _FakeTranslationProvider(),
      speechOutputProvider: speaker,
      autoSpeakTranslation: true,
      config: _config(),
    );
    addTearDown(controller.dispose);

    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_1',
      text: 'hello',
      language: 'en',
    ));
    await pumpEventQueue();

    expect(speaker.spoken.single, ('你好', 'zh'));
    await controller.stop();
    expect(speaker.stopCount, greaterThanOrEqualTo(1));
  });

  test('recovers speech queue after a stuck platform speak call', () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final speaker = FakeSpeechOutputProvider(hangFirstSpeak: true);
    final controller = RealtimeController(
      repository: repository,
      audioCapture: _NoopAudioCapture(),
      mobileAsrProvider: asr,
      mobileTranslationProvider: _FakeTranslationProvider(),
      speechOutputProvider: speaker,
      autoSpeakTranslation: true,
      speechOutputTimeout: const Duration(milliseconds: 20),
      config: _config(),
    );
    addTearDown(controller.dispose);

    await controller.start();
    asr.emit(const AsrTextSegment(id: 'asr_1', text: 'first', language: 'en'));
    await pumpEventQueue();
    await Future<void>.delayed(const Duration(milliseconds: 750));
    asr.emit(const AsrTextSegment(id: 'asr_2', text: 'second', language: 'en'));
    await Future<void>.delayed(const Duration(milliseconds: 80));
    await pumpEventQueue();

    expect(speaker.spoken, <(String, String)>[('第一句', 'zh'), ('第二句', 'zh')]);
    expect(speaker.stopCount, greaterThanOrEqualTo(1));
  });

  test('blocks speaker echo for full playback then accepts the next sentence',
      () async {
    final firstSpeech = Completer<SpeechOutputResult>();
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final speaker = FakeSpeechOutputProvider(
      firstSpeakCompleter: firstSpeech,
    );
    final controller = RealtimeController(
      repository: repository,
      audioCapture: _NoopAudioCapture(),
      mobileAsrProvider: asr,
      mobileTranslationProvider: _FakeTranslationProvider(),
      speechOutputProvider: speaker,
      autoSpeakTranslation: true,
      config: _config(),
    );
    addTearDown(controller.dispose);

    await controller.start();
    asr.emit(const AsrTextSegment(id: 'asr_1', text: 'first', language: 'en'));
    await pumpEventQueue();
    asr.emit(const AsrTextSegment(
      id: 'echo_1',
      text: '第一句',
      language: 'zh',
    ));
    asr.emit(const AsrTextSegment(
      id: 'echo_fixed_hint',
      text: '第一句',
      language: 'en',
      languageEvidence: AsrLanguageEvidence.userSelected,
    ));
    await pumpEventQueue();

    expect(controller.segments.map((segment) => segment.id), <String>['asr_1']);
    expect(speaker.spoken, <(String, String)>[('第一句', 'zh')]);
    expect(controller.speechOutputActive, isTrue);
    firstSpeech.complete(const SpeechOutputResult(
      provider: 'fake',
      language: 'zh',
    ));
    await Future<void>.delayed(const Duration(milliseconds: 400));
    expect(controller.speechOutputActive, isFalse);
    asr.emit(const AsrTextSegment(id: 'asr_2', text: 'second', language: 'en'));
    await pumpEventQueue();
    expect(controller.segments.map((segment) => segment.id),
        <String>['asr_1', 'asr_2']);
    expect(speaker.spoken, <(String, String)>[('第一句', 'zh'), ('第二句', 'zh')]);
  });

  test('drops online audio frames while translated speech is playing',
      () async {
    final firstAudio = Completer<PcmAudioOutputResult>();
    final repository = _FakeRealtimeRepository();
    final audioCapture = _FrameAudioCapture();
    final pcmPlayer = FakePcmAudioOutputPlayer(firstPlayCompleter: firstAudio);
    final controller = RealtimeController(
      repository: repository,
      audioCapture: audioCapture,
      mobileAsrProvider: _FakeMobileAsrProvider(),
      speechOutputProvider: FakeSpeechOutputProvider(),
      pcmAudioOutputPlayer: pcmPlayer,
      autoSpeakTranslation: true,
      config: _config(useDeviceAsr: false),
    );
    addTearDown(controller.dispose);

    await controller.start();
    repository.emit(const GatewayRealtimeEvent(
      type: 'translation.final',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      text: '你好',
      language: 'zh',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'audio.output',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      format: 'pcm16',
      sampleRate: 24000,
      sequence: 1,
      data: 'AA==',
    ));
    await pumpEventQueue();
    audioCapture.emitFrame(1);
    await pumpEventQueue();

    expect(repository.sentFrameSequences, isEmpty);
    expect(pcmPlayer.played, <(String, int)>[('AA==', 24000)]);

    firstAudio.complete(const PcmAudioOutputResult(
      provider: 'fake-pcm',
      sampleRate: 24000,
    ));
    await Future<void>.delayed(const Duration(milliseconds: 400));
    audioCapture.emitFrame(2);
    await pumpEventQueue();

    expect(repository.sentFrameSequences, <int>[2]);
  });
}

AppConfig _config({bool useDeviceAsr = true}) {
  return AppConfig(
    apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
    useMockAudio: false,
    useDeviceAsr: useDeviceAsr,
    useLocalSessions: useDeviceAsr,
    useOnDeviceTranslation: useDeviceAsr,
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    autoReverseTargetLanguage: false,
    deviceAsrProvider: 'coreml_nemotron',
    deviceAsrLanguage: 'en',
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
  final sentFrameSequences = <int>[];

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
  bool sendAudio(String sessionId, AudioFrame frame) {
    sentFrameSequences.add(frame.sequence);
    return true;
  }

  @override
  Future<void> end(String sessionId, List<SubtitleSegment> segments) async {}

  @override
  void dispose() {
    unawaited(_events.close());
  }

  void emit(GatewayRealtimeEvent event) => _events.add(event);
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
  Future<void> dispose() async => _segments.close();

  void emit(AsrTextSegment segment) => _segments.add(segment);
}

class _FakeTranslationProvider implements MobileTranslationProvider {
  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    final translated = switch (text) {
      'first' => '第一句',
      'second' => '第二句',
      _ => '你好',
    };
    return MobileTranslationResult(text: translated, provider: 'fake');
  }

  @override
  Future<void> dispose() async {}
}

class _FrameAudioCapture implements AudioCapture {
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
  Future<void> dispose() async => _frames.close();

  void emitFrame(int sequence) {
    _frames.add(AudioFrame(
      sequence: sequence,
      timestampMs: sequence,
      sampleRate: 24000,
      bytes: const <int>[0, 0],
    ));
  }
}
