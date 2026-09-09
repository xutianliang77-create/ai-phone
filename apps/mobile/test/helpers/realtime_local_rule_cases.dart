part of '../realtime_controller_on_device_translation_test.dart';

void localRuleCases() {
  test(
      'local final reuses v1.0 rules before MT and saves both raw and optimized text',
      () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final translator = _RuleInputTranslator();
    final controller = _controller(repository, asr, translator,
        useLocalSessions: true, sourceLanguage: 'zh', targetLanguage: 'en');
    addTearDown(controller.dispose);
    await controller.start();
    const raw = ' 请把会议既要发给李明确认 ';
    AsrTextSegment event(bool finalValue, int revision) => AsrTextSegment(
        id: 'local-rules',
        text: raw,
        language: 'zh',
        isFinal: finalValue,
        languageEvidence: AsrLanguageEvidence.userSelected,
        captureId: asr.lastConfig!.captureId,
        languagePolicyKey: asr.lastConfig!.languagePolicyKey,
        revision: revision);
    asr.emit(event(false, 1));
    await pumpEventQueue();
    expect(controller.segments.single.sourceText, raw.trim());
    expect(translator.inputs, isEmpty);
    asr.emit(event(true, 2));
    await pumpEventQueue();
    expect(translator.inputs.single, '请把会议纪要发给李明确认');
    final segment = controller.segments.single;
    expect(segment.rawText, raw);
    expect(segment.optimizedText, '请把会议纪要发给李明确认');
    expect(segment.sourceText, segment.optimizedText);
    expect(segment.translatedText, 'The meeting minutes have been sent.');
    expect(segment.refinement?['operations'], ['term_correction']);
    expect(segment.refinement?['provider'], 'local_rules');
    expect(repository.sentTextSegments, isEmpty);
    await controller.stop();
    expect(repository.endedSegments.single.rawText, raw);
    expect(repository.endedSegments.single.translatedText,
        'The meeting minutes have been sent.');
    expect(
        repository.endedSegments.single.optimizedText, segment.optimizedText);
  });
  test(
      'new final revision replaces old refinement metadata rather than inheriting it',
      () async {
    final repository = _FakeRealtimeRepository(),
        asr = _FakeMobileAsrProvider();
    final controller = _controller(repository, asr, _RuleInputTranslator(),
        useLocalSessions: true, sourceLanguage: 'zh', targetLanguage: 'en');
    addTearDown(controller.dispose);
    await controller.start();
    for (final row in [(1, '会议既要已经发送'), (2, '会议纪要已经确认')]) {
      asr.emit(AsrTextSegment(
          id: 'revision',
          text: row.$2,
          language: 'zh',
          languageEvidence: AsrLanguageEvidence.userSelected,
          captureId: asr.lastConfig!.captureId,
          languagePolicyKey: asr.lastConfig!.languagePolicyKey,
          revision: row.$1));
      await pumpEventQueue();
    }
    expect(controller.segments.single.rawText, '会议纪要已经确认');
    expect(controller.segments.single.optimizedText, '会议纪要已经确认');
    expect(controller.segments.single.refinement?['operations'], isEmpty);
    expect(controller.segments.single.refinement?['provider'], 'off');
  });
}

class _RuleInputTranslator extends _FakeTranslationProvider {
  _RuleInputTranslator() : super('The meeting minutes have been sent.');
  final inputs = <String>[];
  @override
  Future<MobileTranslationResult?> translate(
      String text, MobileTranslationConfig config) {
    inputs.add(text);
    return super.translate(text, config);
  }
}
