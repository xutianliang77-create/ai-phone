part of '../realtime_controller_speech_test.dart';

void registerSpeechQueueCases() {
  test('v1.0 correction keeps native identity for translation and speech commit', () async {
    final h = _RevisionHarness(config: _config().copyWith(
        sourceLanguage: 'zh', targetLanguage: 'en',
        autoReverseTargetLanguage: false));
    addTearDown(h.controller.dispose);
    await h.controller.start();
    h.asr.emitVersion('rules', '请把会议既要发给李明确认', 1, language: 'zh');
    await pumpEventQueue();
    expect(h.translator.texts, ['请把会议纪要发给李明确认']);
    expect(h.speaker.spoken, [('译文请把会议纪要发给李明确认', 'en')]);
    expect(h.controller.segments.single.refinement?['speechTiming'],
        containsPair('status', 'finished'));
    await h.controller.stop();
    expect(h.repository.saved.single.rawText, '请把会议既要发给李明确认');
    expect(h.repository.saved.single.translatedText, '译文请把会议纪要发给李明确认');
  });
  test(
      'cancelled platform speak cannot hold new translations until its old timeout',
      () async {
    final old = Completer<SpeechOutputResult>();
    final repo = _FakeRealtimeRepository(), asr = _FakeMobileAsrProvider();
    final speaker = FakeSpeechOutputProvider(firstSpeakCompleter: old);
    final controller = RealtimeController(
        repository: repo,
        audioCapture: _NoopAudioCapture(),
        mobileAsrProvider: asr,
        mobileTranslationProvider: _FakeTranslationProvider(),
        speechOutputProvider: speaker,
        autoSpeakTranslation: true,
        speechOutputTimeout: const Duration(milliseconds: 500),
        config: _config());
    addTearDown(controller.dispose);
    await controller.start();
    asr.emit(const AsrTextSegment(id: 'old', text: 'first', language: 'en'));
    await pumpEventQueue();
    await controller.setAutoSpeakTranslation(false);
    await controller.setAutoSpeakTranslation(true);
    asr.emit(const AsrTextSegment(id: 'new', text: 'second', language: 'en'));
    await pumpEventQueue();
    expect(speaker.spoken.map((s) => s.$1), ['第一句', '第二句']);
    final stops = speaker.stopCount;
    await Future<void>.delayed(const Duration(milliseconds: 650));
    expect(speaker.stopCount, stops,
        reason: 'obsolete timeout cannot stop a newer playback');
    old.complete(const SpeechOutputResult(provider: 'fake', language: 'zh'));
  });
}
