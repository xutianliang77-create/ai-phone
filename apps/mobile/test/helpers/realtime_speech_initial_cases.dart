part of '../realtime_controller_speech_test.dart';

void registerInitialSpeechCases() {
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
    expect(
      (controller.segments
          .singleWhere((segment) => segment.id == 'asr_1')
          .refinement?['speechTiming'] as Map<String, Object?>?)?['status'],
      'timed_out',
    );
    expect(
      (controller.segments
          .singleWhere((segment) => segment.id == 'asr_2')
          .refinement?['speechTiming'] as Map<String, Object?>?)?['status'],
      'finished',
    );
    expect(speaker.stopCount, greaterThanOrEqualTo(1));
  });

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
}
