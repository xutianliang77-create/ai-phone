part of '../realtime_controller_on_device_translation_test.dart';

void hypothesisCases() {
  for (final translated in [null, 'Hello']) {
    test('versioned drafts are not final history; committed repeats kept ($translated)', () async {
      final repository = _FakeRealtimeRepository();
      final asr = _FakeMobileAsrProvider();
      final controller = _controller(repository, asr,
          _FakeTranslationProvider(translated), useLocalSessions: true,
          sourceLanguage: 'zh', targetLanguage: 'en');
      addTearDown(controller.dispose);
      await controller.start();
      AsrTextSegment event(String id, String text, int revision,
          {bool finalValue = false, bool retract = false, String? capture}) =>
          AsrTextSegment(id: id, text: text, language: 'zh',
            isFinal: finalValue, isRetraction: retract,
            languageEvidence: AsrLanguageEvidence.userSelected,
            captureId: capture ?? asr.lastConfig!.captureId,
            languagePolicyKey: asr.lastConfig!.languagePolicyKey,
            revision: revision);
      asr.emit(event('phrase', '你', 1));
      await pumpEventQueue();
      asr.emit(event('phrase', '你好', 2, finalValue: true));
      await pumpEventQueue();
      expect(controller.segments.single.translatedText, translated ?? '');
      asr.emit(event('phrase', '', 3, retract: true)); // cannot revoke final
      asr.emit(event('repeat', '你好', 4, finalValue: true));
      await pumpEventQueue();
      asr.emit(event('revoked', '错误草稿', 5));
      await pumpEventQueue();
      asr.emit(event('revoked', '', 4, retract: true)); // stale revision
      asr.emit(event('revoked', '', 6, retract: true, capture: 'old'));
      await pumpEventQueue();
      expect(controller.segments.any((s) => s.id == 'revoked'), isTrue);
      asr.emit(event('revoked', '', 7, retract: true));
      await pumpEventQueue();
      expect(controller.segments.any((s) => s.id == 'revoked'), isFalse);
      asr.emit(event('unfinished', '未完成草稿', 8));
      await pumpEventQueue(); // unrelated update must not resurrect revoked draft
      expect(controller.segments.map((s) => s.id), ['phrase', 'repeat', 'unfinished']);
      await controller.stop();
      expect(repository.endedSegments.map((s) => s.id), ['phrase', 'repeat']);
      expect(repository.endedSegments.map((s) => s.sourceText), ['你好', '你好']);
      expect(repository.sentTextSegments, isEmpty);
    });
  }
}
