import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/speech_capture_gate.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';
import 'package:translation_mobile/src/platform/audio/audio_session_coordinator.dart';
import 'package:translation_mobile/src/platform/speech/pcm_audio_output_player.dart';
import 'package:translation_mobile/src/platform/speech/speech_output_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

import 'helpers/fake_audio_session_coordinator.dart';
import 'helpers/fake_pcm_audio_output_player.dart';
import 'helpers/fake_speech_output_provider.dart';
import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  test('keeps online capture open on headphones during TTS', () async {
    final playback = Completer<PcmAudioOutputResult>();
    final repository = FakeRealtimeRepository();
    final capture = FakeAudioCapture();
    final audioSession = FakeAudioSessionCoordinator();
    final player = FakePcmAudioOutputPlayer(firstPlayCompleter: playback);
    final controller = realtimeControllerForTest(
      repository,
      capture,
      pcmAudioOutputPlayer: player,
      autoSpeakTranslation: true,
      audioSessionCoordinator: audioSession,
    );
    addTearDown(controller.dispose);
    await controller.start();

    audioSession.emit(const AudioSessionEvent(
      type: AudioSessionEventType.routeChanged,
      route: AudioOutputRoute.headphones,
    ));
    repository.emit(_audioOutput(1));
    await pumpEventQueue();
    capture.emitFrame(1);
    await pumpEventQueue();

    expect(repository.sentFrameSequences, <int>[1]);

    audioSession.emit(const AudioSessionEvent(
      type: AudioSessionEventType.routeChanged,
      route: AudioOutputRoute.speaker,
    ));
    await pumpEventQueue();
    capture.emitFrame(2);
    await pumpEventQueue();
    expect(repository.sentFrameSequences, <int>[1]);

    playback.complete(const PcmAudioOutputResult(
      provider: 'fake-pcm',
      sampleRate: 24000,
    ));
  });

  test('reopens speaker capture after each of 20 TTS echo windows', () async {
    var now = DateTime(2026);
    final repository = FakeRealtimeRepository();
    final capture = FakeAudioCapture();
    final controller = realtimeControllerForTest(
      repository,
      capture,
      pcmAudioOutputPlayer: FakePcmAudioOutputPlayer(),
      autoSpeakTranslation: true,
      speechCaptureGate: SpeechCaptureGate(now: () => now),
    );
    addTearDown(controller.dispose);
    await controller.start();

    for (var sequence = 1; sequence <= 20; sequence += 1) {
      repository.emit(_audioOutput(sequence));
      await pumpEventQueue();
      capture.emitFrame(sequence * 2 - 1);
      await pumpEventQueue();
      now = now.add(const Duration(milliseconds: 351));
      capture.emitFrame(sequence * 2);
      await pumpEventQueue();
    }

    expect(
      repository.sentFrameSequences,
      List<int>.generate(20, (index) => (index + 1) * 2),
    );
  });

  test('keeps device ASR accepting speech while headset TTS is active',
      () async {
    final playback = Completer<SpeechOutputResult>();
    final repository = FakeRealtimeRepository();
    final asr = _DeviceAsrProvider();
    final audioSession = FakeAudioSessionCoordinator();
    final controller = RealtimeController(
      repository: repository,
      audioCapture: FakeAudioCapture(),
      mobileAsrProvider: asr,
      mobileTranslationProvider: _TranslationProvider(),
      speechOutputProvider: FakeSpeechOutputProvider(
        firstSpeakCompleter: playback,
      ),
      audioSessionCoordinator: audioSession,
      autoSpeakTranslation: true,
      config: _deviceConfig(),
    );
    addTearDown(controller.dispose);
    await controller.start();
    audioSession.emit(const AudioSessionEvent(
      type: AudioSessionEventType.routeChanged,
      route: AudioOutputRoute.bluetooth,
    ));
    await pumpEventQueue();

    asr.emit(const AsrTextSegment(id: 'asr_1', text: 'first', language: 'en'));
    await pumpEventQueue();
    asr.emit(const AsrTextSegment(id: 'asr_2', text: 'second', language: 'en'));
    await pumpEventQueue();

    expect(controller.segments.map((segment) => segment.id),
        <String>['asr_1', 'asr_2']);
    final ttsBegin = asr.diagnosticEvents.firstWhere(
      (event) => event['type'] == 'tts.begin',
    );
    expect(
      (ttsBegin['payload']!
          as Map<String, Object?>)['requiresAcousticEchoSuppression'],
      isFalse,
    );
    playback.complete(const SpeechOutputResult(
      provider: 'fake',
      language: 'zh',
    ));
    await pumpEventQueue();
  });

  test('drops speaker echo whose final arrives after playback', () async {
    final playback = Completer<SpeechOutputResult>();
    final repository = FakeRealtimeRepository();
    final asr = _DeviceAsrProvider();
    final controller = RealtimeController(
      repository: repository,
      audioCapture: FakeAudioCapture(),
      mobileAsrProvider: asr,
      mobileTranslationProvider: _TranslationProvider(),
      speechOutputProvider: FakeSpeechOutputProvider(
        firstSpeakCompleter: playback,
      ),
      autoSpeakTranslation: true,
      config: _deviceConfig(),
    );
    addTearDown(controller.dispose);
    await controller.start();

    asr.emit(const AsrTextSegment(id: 'asr_1', text: 'first', language: 'en'));
    await pumpEventQueue();
    asr.emit(const AsrTextSegment(
      id: 'speaker_echo',
      text: '译文 first',
      language: 'zh',
      isFinal: false,
    ));
    await pumpEventQueue();

    expect(controller.segments.map((segment) => segment.id), <String>['asr_1']);
    playback.complete(const SpeechOutputResult(
      provider: 'fake',
      language: 'zh',
    ));
    await pumpEventQueue();

    asr.emit(const AsrTextSegment(
      id: 'speaker_echo',
      text: '译文 first',
      language: 'zh',
      isFinal: true,
    ));
    await pumpEventQueue();
    expect(controller.segments.map((segment) => segment.id), <String>['asr_1']);

    asr.emit(const AsrTextSegment(
      id: 'same_meaning',
      text: 'first',
      language: 'en',
    ));
    await pumpEventQueue();

    expect(controller.segments.map((segment) => segment.id),
        <String>['asr_1', 'same_meaning']);
  });

  test('accepts opposite-language barge-in and stops speaker TTS', () async {
    final playback = Completer<SpeechOutputResult>();
    final repository = FakeRealtimeRepository();
    final asr = _DeviceAsrProvider();
    final speaker = FakeSpeechOutputProvider(firstSpeakCompleter: playback);
    final controller = RealtimeController(
      repository: repository,
      audioCapture: FakeAudioCapture(),
      mobileAsrProvider: asr,
      mobileTranslationProvider: _TranslationProvider(),
      speechOutputProvider: speaker,
      autoSpeakTranslation: true,
      config: _deviceConfig(),
    );
    addTearDown(controller.dispose);
    await controller.start();

    asr.emit(const AsrTextSegment(id: 'asr_1', text: 'first', language: 'en'));
    await pumpEventQueue();
    asr.emit(const AsrTextSegment(id: 'asr_2', text: 'second', language: 'en'));
    await pumpEventQueue();

    expect(controller.segments.map((segment) => segment.id),
        <String>['asr_1', 'asr_2']);
    expect(speaker.stopCount, greaterThanOrEqualTo(1));
    playback.complete(const SpeechOutputResult(
      provider: 'fake',
      language: 'zh',
    ));
  });
}

GatewayRealtimeEvent _audioOutput(int sequence) {
  return GatewayRealtimeEvent(
    type: 'audio.output',
    sessionId: 'sess_1',
    segmentId: 'seg_$sequence',
    format: 'pcm16',
    sampleRate: 24000,
    sequence: sequence,
    data: 'audio_$sequence',
  );
}

AppConfig _deviceConfig() {
  return AppConfig(
    apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
    useMockAudio: false,
    useDeviceAsr: true,
    useLocalSessions: true,
    useOnDeviceTranslation: true,
    deviceAsrProvider: 'coreml_nemotron',
    deviceAsrLanguage: 'auto',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    deviceAsrDiagnosticCaptureEnabled: true,
    serverOwnedHistory: false,
  );
}

class _DeviceAsrProvider
    implements MobileAsrProvider, MobileAsrDiagnosticTimeline {
  final _segments = StreamController<AsrTextSegment>.broadcast();
  final diagnosticEvents = <Map<String, Object?>>[];

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
  Future<void> recordDiagnosticEvent(
    String type, {
    Map<String, Object?> payload = const <String, Object?>{},
  }) async {
    diagnosticEvents.add(<String, Object?>{
      'type': type,
      'payload': payload,
    });
  }

  @override
  Future<void> dispose() => _segments.close();
}

class _TranslationProvider implements MobileTranslationProvider {
  @override
  Future<MobileTranslationResult> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    return MobileTranslationResult(text: '译文：$text', provider: 'fake');
  }

  @override
  Future<void> dispose() async {}
}
