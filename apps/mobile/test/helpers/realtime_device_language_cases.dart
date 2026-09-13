part of '../realtime_controller_on_device_translation_test.dart';

void deviceLanguageCases() {
  for (final local in [true, false]) {
    test('fixed French hint stays French on device, local=$local', () async {
      final repository = _FakeRealtimeRepository();
      final asr = _FakeMobileAsrProvider();
      final translator = _FakeTranslationProvider('訳文');
      final controller =
          _languageController(repository, asr, translator, local: local);
      addTearDown(controller.dispose);
      await controller.start();
      asr.emit(_languageSegment('fr-FR', text: ' <noise> bonjour   ici '));
      await pumpEventQueue();
      expect(_directions(translator), ['fr->ja']);
      expect(controller.segments.single.sourceText, 'bonjour ici');
      expect(controller.segments.single.sourceLanguage, 'fr');
      expect(controller.segments.single.targetLanguage, 'ja');
      expect(repository.sentTextSegments, isEmpty);
    });

    for (final selected in local ? ['ja'] : ['auto', 'ja']) {
      test('hint cannot stand in for detected language, $selected/$local',
          () async {
        final repository = _FakeRealtimeRepository();
        final asr = _FakeMobileAsrProvider();
        final translator = _FakeTranslationProvider('wrong');
        final controller = _languageController(repository, asr, translator,
            local: local, source: selected);
        addTearDown(controller.dispose);
        await controller.start();
        asr.emit(_languageSegment('fr-FR'));
        await pumpEventQueue();
        expect(translator.configs, isEmpty);
        expect(repository.sentTextSegments, isEmpty);
        expect(controller.segments.single.sourceLanguage, 'auto');
        expect(controller.segments.single.translatedText, isEmpty);
        expect(controller.status, RealtimeStatus.active);
      });
    }

    for (final evidence in [
      AsrLanguageEvidence.unknown,
      AsrLanguageEvidence.mixed,
      AsrLanguageEvidence.textInferred
    ]) {
      test(
          'keeps confirmed unresolved source across clean/stop, $evidence/$local',
          () async {
        final repository = _FakeRealtimeRepository();
        final asr = _FakeMobileAsrProvider();
        final translator = _FakeTranslationProvider('wrong');
        final controller =
            _languageController(repository, asr, translator, local: local);
        addTearDown(controller.dispose);
        await controller.start();
        asr.emit(_languageSegment('fr',
            text: ' bonjour 你好 ', evidence: evidence, isFinal: false));
        await pumpEventQueue();
        asr.emit(_languageSegment('fr',
            text: ' bonjour 你好 ', evidence: evidence, isFinal: true));
        await pumpEventQueue();
        await controller.stop();
        expect(repository.sentTextSegments, isEmpty);
        expect(translator.configs, isEmpty);
        expect(repository.endedSegments.single.sourceText, 'bonjour 你好');
        expect(repository.endedSegments.single.translatedText, isEmpty);
        expect(repository.endedSegments.single.sourceLanguage, 'auto');
      });
    }

    test('qualified metadata uses existing configured pair A/A/B, $local',
        () async {
      final repository = _FakeRealtimeRepository();
      final asr = _FakeMobileAsrProvider();
      final translator = _FakeTranslationProvider('訳文');
      final controller = _languageController(repository, asr, translator,
          local: local, autoReverse: true);
      addTearDown(controller.dispose);
      await controller.start();
      for (final row in ['fr-FR', 'fr-CA', 'ja-JP', 'de-DE'].indexed) {
        asr.emit(_languageSegment(row.$2,
            id: '${row.$1}', evidence: AsrLanguageEvidence.detected));
      }
      await pumpEventQueue();
      expect(_directions(translator), ['fr->ja', 'fr->ja', 'ja->fr']);
      expect(controller.segments.last.sourceLanguage, 'de');
      expect(controller.segments.last.translatedText, isEmpty);
      expect(repository.sentTextSegments, isEmpty);
    });

    if (!local) {
      test('unknown detection never defaults to opposite language, $local',
          () async {
        final repository = _FakeRealtimeRepository();
        final asr = _FakeMobileAsrProvider();
        final translator = _FakeTranslationProvider('wrong');
        final controller = _languageController(repository, asr, translator,
            local: local, source: 'auto');
        addTearDown(controller.dispose);
        await controller.start();
        asr.emit(
            _languageSegment('auto', evidence: AsrLanguageEvidence.detected));
        await pumpEventQueue();
        expect(translator.configs, isEmpty);
        expect(repository.sentTextSegments, isEmpty);
        expect(controller.segments.single.sourceLanguage, 'auto');
      });
    }

    test('unresolved replacement clears obsolete translation, local=$local',
        () async {
      final repository = _FakeRealtimeRepository();
      final asr = _FakeMobileAsrProvider();
      final translator = _FakeTranslationProvider('old translation');
      final controller =
          _languageController(repository, asr, translator, local: local);
      addTearDown(controller.dispose);
      await controller.start();
      asr.emit(_languageSegment('fr'));
      await pumpEventQueue();
      expect(controller.segments.single.translatedText, 'old translation');
      asr.emit(_languageSegment('fr',
          text: 'bonjour 你好', evidence: AsrLanguageEvidence.mixed));
      await pumpEventQueue();
      expect(controller.segments.single.sourceText, 'bonjour 你好');
      expect(controller.segments.single.translatedText, isEmpty);
      expect(controller.segments.single.targetLanguage, isNull);
      expect(controller.segments.single.provider, isNull);
      expect(translator.configs.length, 1);
      expect(repository.sentTextSegments, isEmpty);
    });

    for (final outcome in ['result', 'null', 'error']) {
      test('old async $outcome cannot affect replacement session, $local',
          () async {
        final repository = _FakeRealtimeRepository();
        final asr = _FakeMobileAsrProvider();
        final translator = _DeferredTranslationProvider();
        final controller =
            _languageController(repository, asr, translator, local: local);
        addTearDown(controller.dispose);
        await controller.start();
        asr.emit(_languageSegment('fr', text: 'hello Docker'));
        await pumpEventQueue();
        expect(translator.calls, 1);
        controller.handleGatewayEvent(const GatewayRealtimeEvent(
            type: 'error', sessionId: 'sess_1', message: 'test failure'));
        await controller.start();
        expect(controller.status, RealtimeStatus.active);
        if (outcome == 'error') {
          translator.result.completeError(StateError('old translation failed'));
        } else {
          translator.result.complete(outcome == 'null'
              ? null
              : const MobileTranslationResult(
                  text: 'old result', provider: 'fake'));
        }
        await pumpEventQueue();
        // Fake repository intentionally reuses sess_1: object ownership matters.
        expect(controller.status, RealtimeStatus.active);
        expect(controller.segments, isEmpty);
        expect(repository.sentTextSegments, isEmpty);
        expect(translator.calls, 1); // No stale protected-text retry, either.
      });
    }
  }

  for (final nativeFinal in [true, false]) {
    test('online device partial stays local, nativeFinal=$nativeFinal',
        () async {
      final repository = _FakeRealtimeRepository();
      final asr = _FakeMobileAsrProvider();
      final translator = _FakeTranslationProvider('訳文');
      final controller = _languageController(repository, asr, translator);
      addTearDown(controller.dispose);
      await controller.start();
      asr.emit(_languageSegment('fr-FR', isFinal: false));
      await pumpEventQueue();
      expect(controller.segments.single.sourceText, 'bonjour');
      expect(translator.configs, isEmpty);
      expect(repository.sentTextSegments, isEmpty);
      if (nativeFinal) {
        asr.emit(_languageSegment('fr-FR', text: 'bonjour ici'));
        await pumpEventQueue();
      }
      await controller.stop();
      expect(_directions(translator), nativeFinal ? ['fr->ja'] : isEmpty);
      expect(repository.sentTextSegments, isEmpty);
      expect(repository.endedSegments.single.translatedText,
          nativeFinal ? '訳文' : '');
    });
  }

  test('automatic reverse uses configured French/Japanese pair, not zh/en',
      () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final translator = _FakeTranslationProvider('訳文');
    final controller =
        _languageController(repository, asr, translator, autoReverse: true);
    addTearDown(controller.dispose);
    await controller.start();
    for (final row in ['fr-FR', 'fr-CA', 'ja-JP'].indexed) {
      asr.emit(_languageSegment(row.$2,
          id: '${row.$1}', evidence: AsrLanguageEvidence.detected));
    }
    await pumpEventQueue();
    expect(_directions(translator), ['fr->ja', 'fr->ja', 'ja->fr']);
    expect(repository.sentTextSegments, isEmpty);
  });

  test('new auto input never fabricates missing reverse side of a pair',
      () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final translator = _FakeTranslationProvider('wrong');
    final controller = _languageController(repository, asr, translator,
        source: 'auto', autoReverse: true);
    addTearDown(controller.dispose);
    await controller.start();
    asr.emit(_languageSegment('ja-JP', evidence: AsrLanguageEvidence.detected));
    await pumpEventQueue();
    expect(translator.configs, isEmpty);
    expect(repository.sentTextSegments, isEmpty);
    expect(controller.segments.single.sourceLanguage, 'ja');
    expect(controller.segments.single.translatedText, isEmpty);
  });

  test('fixed non-English final fallback preserves language and provenance',
      () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final translator = _FakeTranslationProvider(null);
    final controller = _languageController(repository, asr, translator);
    addTearDown(controller.dispose);
    await controller.start();
    asr.emit(_languageSegment('fr-FR'));
    await pumpEventQueue();
    expect(_directions(translator), ['fr->ja']);
    final sent = repository.sentTextSegments.single;
    expect(sent.language, 'fr');
    expect(sent.languageEvidence, AsrLanguageEvidence.userSelected);
  });
}

AsrTextSegment _languageSegment(
  String language, {
  String id = 'sentence',
  String text = 'bonjour',
  bool isFinal = true,
  AsrLanguageEvidence evidence = AsrLanguageEvidence.userSelected,
}) =>
    AsrTextSegment(
        id: id,
        text: text,
        language: language,
        isFinal: isFinal,
        languageEvidence: evidence);

List<String> _directions(_FakeTranslationProvider translator) =>
    translator.configs
        .map((config) => '${config.sourceLanguage}->${config.targetLanguage}')
        .toList();

RealtimeController _languageController(_FakeRealtimeRepository repository,
        _FakeMobileAsrProvider asr, MobileTranslationProvider translator,
        {bool local = false, String source = 'fr', bool autoReverse = false}) =>
    RealtimeController(
        repository: repository,
        audioCapture: _NoopAudioCapture(),
        mobileAsrProvider: asr,
        mobileTranslationProvider: translator,
        config: AppConfig(
          apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
          useMockAudio: false,
          useDeviceAsr: true,
          useLocalSessions: local,
          useOnDeviceTranslation: true,
          deviceAsrProvider: 'apple_speech_transcriber',
          deviceAsrLanguage: source,
          deviceAsrAutoDownloadModel: false,
          deviceAsrModelChunkMs: 32,
          serverOwnedHistory: !local,
          sourceLanguage: source,
          targetLanguage: 'ja',
          autoReverseTargetLanguage: autoReverse,
          realtimeMode: 'conversation',
        ));

class _DeferredTranslationProvider implements MobileTranslationProvider {
  final result = Completer<MobileTranslationResult?>();
  var calls = 0;
  @override
  Future<MobileTranslationResult?> translate(
      String text, MobileTranslationConfig config) {
    calls++;
    return result.future;
  }

  @override
  Future<void> dispose() async {}
}
