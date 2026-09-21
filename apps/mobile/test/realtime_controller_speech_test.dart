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

part 'helpers/realtime_speech_output_fakes.dart';

part 'helpers/realtime_speech_initial_cases.dart';

void main() {
  registerVoiceRouteCases();
  registerSpeechQueueCases();
  registerSpeechStopDrainTest();
  registerDeviceRevisionCases();
  registerInitialSpeechCases();

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
      revision: 1,
      text: '你好',
      language: 'zh',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'audio.output',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      revision: 1,
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

  test('drops delayed public PCM from a superseded translation revision',
      () async {
    final repository = _FakeRealtimeRepository();
    final pcmPlayer = FakePcmAudioOutputPlayer();
    final controller = RealtimeController(
      repository: repository,
      audioCapture: _NoopAudioCapture(),
      mobileAsrProvider: _FakeMobileAsrProvider(),
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
      revision: 1,
      text: '旧译文',
      language: 'zh',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'translation.final',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      revision: 2,
      text: '新译文',
      language: 'zh',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'audio.output',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      revision: 1,
      format: 'pcm16',
      sampleRate: 24000,
      sequence: 1,
      data: 'AA==',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'audio.output',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      revision: 2,
      format: 'pcm16',
      sampleRate: 24000,
      sequence: 2,
      data: 'AQE=',
      isFinal: true,
    ));
    await pumpEventQueue();

    expect(pcmPlayer.played, <(String, int)>[('AQE=', 24000)]);
  });

  test('stops active public PCM when a newer transcript revision arrives',
      () async {
    final firstAudio = Completer<PcmAudioOutputResult>();
    final repository = _FakeRealtimeRepository();
    final pcmPlayer = FakePcmAudioOutputPlayer(firstPlayCompleter: firstAudio);
    final controller = RealtimeController(
      repository: repository,
      audioCapture: _NoopAudioCapture(),
      mobileAsrProvider: _FakeMobileAsrProvider(),
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
      revision: 1,
      text: '旧译文',
      language: 'zh',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'audio.output',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      revision: 1,
      format: 'pcm16',
      sampleRate: 24000,
      sequence: 1,
      data: 'AA==',
      isFinal: true,
    ));
    await pumpEventQueue();
    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.final',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      revision: 2,
      text: '新原文',
      language: 'en',
    ));
    await pumpEventQueue();

    expect(pcmPlayer.stopCount, greaterThanOrEqualTo(1));
    firstAudio.complete(const PcmAudioOutputResult(
      provider: 'fake-pcm',
      sampleRate: 24000,
    ));
  });

  test('cancels queued public PCM when a newer transcript revision arrives',
      () async {
    final firstAudio = Completer<PcmAudioOutputResult>();
    final repository = _FakeRealtimeRepository();
    final pcmPlayer = FakePcmAudioOutputPlayer(firstPlayCompleter: firstAudio);
    final controller = RealtimeController(
      repository: repository,
      audioCapture: _NoopAudioCapture(),
      mobileAsrProvider: _FakeMobileAsrProvider(),
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
      revision: 1,
      text: '旧译文',
      language: 'zh',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'audio.output',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      revision: 1,
      format: 'pcm16',
      sampleRate: 24000,
      sequence: 1,
      data: 'AA==',
    ));
    repository.emit(const GatewayRealtimeEvent(
      type: 'audio.output',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      revision: 1,
      format: 'pcm16',
      sampleRate: 24000,
      sequence: 2,
      data: 'AQE=',
      isFinal: true,
    ));
    await pumpEventQueue();
    repository.emit(const GatewayRealtimeEvent(
      type: 'transcript.final',
      sessionId: 'sess_1',
      segmentId: 'seg_1',
      revision: 2,
      text: '新原文',
      language: 'en',
    ));
    await pumpEventQueue();
    firstAudio.complete(const PcmAudioOutputResult(
      provider: 'fake-pcm',
      sampleRate: 24000,
    ));
    await pumpEventQueue();

    expect(pcmPlayer.stopCount, greaterThanOrEqualTo(1));
    expect(pcmPlayer.played, <(String, int)>[('AA==', 24000)]);
  });
}
