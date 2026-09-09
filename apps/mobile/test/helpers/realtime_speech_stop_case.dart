part of '../realtime_controller_speech_test.dart';

void registerSpeechStopDrainTest() {
  test('personal voice never silently falls back to the system speaker',
      () async {
    final speaker = FakeSpeechOutputProvider();
    final asr = _FakeMobileAsrProvider();
    final config = _config().copyWith(realtimeVoiceOutputMode: 'my_voice');
    final controller = RealtimeController(
      repository: _FakeRealtimeRepository(),
      audioCapture: _NoopAudioCapture(),
      mobileAsrProvider: asr,
      mobileTranslationProvider: _FakeTranslationProvider(),
      speechOutputProvider: speaker,
      autoSpeakTranslation: true,
      config: config,
    );
    addTearDown(controller.dispose);
    await controller.start();
    asr.emit(const AsrTextSegment(
        id: 'voice_unavailable', text: 'hello', language: 'en'));
    await pumpEventQueue();
    expect(speaker.spoken, isEmpty);
    expect(controller.segments.single.translatedText, '你好');
    expect(controller.message, contains('所选声音暂不可用'));
    expect(config.realtimeVoiceOutputMode, 'my_voice');
    expect(
        await controller.setAutoSpeakTranslation(true,
            voiceOutputMode: 'my_voice'),
        false);
  });

  test('stops playback before awaiting the native ASR tail drain', () async {
    final drain = Completer<void>();
    final asr = _DrainingAsr(drain);
    final speaker = FakeSpeechOutputProvider();
    final controller = RealtimeController(
      repository: _FakeRealtimeRepository(),
      audioCapture: _NoopAudioCapture(),
      mobileAsrProvider: asr,
      mobileTranslationProvider: _FakeTranslationProvider(),
      speechOutputProvider: speaker,
      autoSpeakTranslation: true,
      config: _config(),
    );
    addTearDown(controller.dispose);
    await controller.start();
    asr.emit(
        const AsrTextSegment(id: 'before_stop', text: 'hello', language: 'en'));
    await pumpEventQueue();
    final previousStops = speaker.stopCount;
    final stopping = controller.stop();
    await pumpEventQueue();
    expect(controller.status, RealtimeStatus.ending);
    expect(speaker.stopCount, greaterThan(previousStops));
    drain.complete();
    await stopping;
    expect(controller.status, RealtimeStatus.ended);
  });
}

class _DrainingAsr extends _FakeMobileAsrProvider {
  _DrainingAsr(this.drain);
  final Completer<void> drain;
  @override
  Future<void> stop() => drain.future;
}
