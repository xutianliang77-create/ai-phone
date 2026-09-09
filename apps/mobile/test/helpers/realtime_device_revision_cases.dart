part of '../realtime_controller_speech_test.dart';

void registerDeviceRevisionCases() {
  test('native revision reaches subtitles and duplicate finals never replay',
      () async {
    final h = _RevisionHarness();
    addTearDown(h.controller.dispose);
    await h.controller.start();
    h.asr.emitVersion('a', 'first', 1);
    await pumpEventQueue();
    h.asr.emitVersion('a', 'first', 2);
    h.asr.emitVersion('a', 'conflicting equal version', 2);
    h.asr.emitVersion('a', 'stale', 0);
    await pumpEventQueue();
    expect(h.translator.texts, ['first']);
    expect(h.speaker.spoken.length, 1);
    expect(h.controller.segments.single.sourceText, 'first');
    expect(h.controller.segments.single.revision, 1);
    h.asr.emitVersion('a', 'second', 3);
    await pumpEventQueue();
    expect(h.controller.segments.single.revision, 3);
    expect(h.controller.segments.single.translatedText, '译文second');
    expect(h.speaker.spoken.length, 1); // Caption correction is not a replay.
    h.asr.emitVersion('b', 'second', 4);
    await pumpEventQueue();
    expect(
        h.speaker.spoken.length, 2); // A real repeated utterance still speaks.
    await h.controller.stop();
    expect(h.repository.saved.map((s) => s.revision), [3, 4]);
  });

  for (final error in [false, true]) {
    test('newer same-turn revision invalidates in-flight result/error=$error',
        () async {
      final waiting = Completer<MobileTranslationResult?>();
      final h = _RevisionHarness(firstTranslation: waiting);
      addTearDown(h.controller.dispose);
      await h.controller.start();
      h.asr.emitVersion('a', 'first', 1);
      await pumpEventQueue();
      h.asr.emitVersion('a', 'second', 2);
      await pumpEventQueue();
      expect(h.controller.segments.single.sourceText, 'second');
      if (error) {
        waiting.completeError(StateError('obsolete failure'));
      } else {
        waiting.complete(
            const MobileTranslationResult(text: 'obsolete', provider: 'fake'));
      }
      await pumpEventQueue();
      expect(h.controller.status, RealtimeStatus.active);
      expect(h.controller.segments.single.translatedText, '译文second');
      expect(h.speaker.spoken, [('译文second', 'zh')]);
      expect(h.repository.sentText, isEmpty);
    });
  }

  test('resume rotates capture identity and rejects old capture/policy events',
      () async {
    final h = _RevisionHarness();
    addTearDown(h.controller.dispose);
    await h.controller.start();
    final old = h.asr.current!;
    h.asr.emitVersion('first', 'first', 1);
    await pumpEventQueue();
    await h.controller.pause();
    await h.controller.start();
    expect(h.asr.current!.captureId, isNot(old.captureId));
    h.asr.emitVersion('old', 'old tail', 2, config: old);
    h.asr.emit(AsrTextSegment(
        id: 'bad-policy',
        text: 'wrong language',
        language: 'en',
        captureId: h.asr.current!.captureId,
        languagePolicyKey: 'obsolete-policy',
        revision: 2,
        languageEvidence: AsrLanguageEvidence.detected));
    h.asr.emitVersion('new', 'second', 1);
    await pumpEventQueue();
    expect(h.controller.segments.map((s) => s.id), ['first', 'new']);
    expect(h.translator.texts, ['first', 'second']);
  });

  test('stop during async playback diagnostic cannot start sound afterwards',
      () async {
    final h = _RevisionHarness(blockSpeechDiagnostic: true);
    addTearDown(h.controller.dispose);
    await h.controller.start();
    h.asr.emitVersion('a', 'first', 1);
    await pumpEventQueue();
    expect(h.asr.speechDiagnosticStarted, true);
    await h.controller.stop();
    h.asr.speechDiagnostic.complete();
    await pumpEventQueue();
    expect(h.speaker.spoken, isEmpty);
    expect(h.repository.saved.single.translatedText, '译文first');
  });

  test('qualified detected input follows saved non-Chinese automatic pair',
      () async {
    final h = _RevisionHarness(
        config: _config().copyWith(
            sourceLanguage: 'auto',
            targetLanguage: 'ja',
            automaticLanguagePair: const TranslationLanguagePair('fr', 'ja')));
    addTearDown(h.controller.dispose);
    await h.controller.start();
    for (final row in ['fr', 'fr', 'ja'].indexed) {
      h.asr.emitVersion('${row.$1}', 'sentence ${row.$1}', row.$1 + 1,
          language: row.$2);
    }
    await pumpEventQueue();
    expect(
        h.translator.configs
            .map((c) => '${c.sourceLanguage}->${c.targetLanguage}'),
        ['fr->ja', 'fr->ja', 'ja->fr']);
    expect(h.asr.current!.languagePolicyKey, contains('|fr|ja'));
  });
}

class _RevisionHarness {
  _RevisionHarness(
      {Completer<MobileTranslationResult?>? firstTranslation,
      bool blockSpeechDiagnostic = false,
      AppConfig? config}) {
    asr = _VersionedAsr(blockSpeechDiagnostic);
    translator = _RevisionTranslator(firstTranslation);
    controller = RealtimeController(
        repository: repository,
        audioCapture: _NoopAudioCapture(),
        mobileAsrProvider: asr,
        mobileTranslationProvider: translator,
        speechOutputProvider: speaker,
        autoSpeakTranslation: true,
        config: config ??
            _config().copyWith(
                automaticLanguagePair:
                    const TranslationLanguagePair('en', 'zh')));
  }
  final repository = _RevisionRepository();
  final speaker = FakeSpeechOutputProvider();
  late final _VersionedAsr asr;
  late final _RevisionTranslator translator;
  late final RealtimeController controller;
}

class _VersionedAsr extends _FakeMobileAsrProvider
    implements MobileAsrDiagnosticTimeline {
  _VersionedAsr(this.blockSpeechDiagnostic);
  final bool blockSpeechDiagnostic;
  final speechDiagnostic = Completer<void>();
  var speechDiagnosticStarted = false;
  MobileAsrConfig? current;
  @override
  Future<void> start(MobileAsrConfig config) async {
    current = config;
  }

  void emitVersion(String id, String text, int revision,
      {MobileAsrConfig? config, String language = 'en'}) {
    final active = config ?? current!;
    emit(AsrTextSegment(
        id: id,
        text: text,
        language: language,
        captureId: active.captureId,
        languagePolicyKey: active.languagePolicyKey,
        revision: revision,
        languageEvidence: AsrLanguageEvidence.detected));
  }

  @override
  Future<void> recordDiagnosticEvent(String type,
      {Map<String, Object?> payload = const {}}) async {
    if (blockSpeechDiagnostic && type == 'tts.begin') {
      speechDiagnosticStarted = true;
      await speechDiagnostic.future;
    }
  }
}

class _RevisionTranslator implements MobileTranslationProvider {
  _RevisionTranslator(this.first);
  final Completer<MobileTranslationResult?>? first;
  final texts = <String>[];
  final configs = <MobileTranslationConfig>[];
  @override
  Future<MobileTranslationResult?> translate(
      String text, MobileTranslationConfig config) async {
    texts.add(text);
    configs.add(config);
    if (texts.length == 1 && first != null) return first!.future;
    return MobileTranslationResult(text: '译文$text', provider: 'fake');
  }

  @override
  Future<void> dispose() async {}
}

class _RevisionRepository extends _FakeRealtimeRepository {
  final saved = <SubtitleSegment>[];
  final sentText = <AsrTextSegment>[];
  @override
  Future<bool> pauseAndWait(String sessionId) async => true;
  @override
  Future<bool> resumeAndWait(String sessionId) async => true;
  @override
  Future<void> end(String sessionId, List<SubtitleSegment> segments) async {
    saved.addAll(segments);
  }

  @override
  bool sendTextSegment(String sessionId, AsrTextSegment segment) {
    sentText.add(segment);
    return true;
  }
}
