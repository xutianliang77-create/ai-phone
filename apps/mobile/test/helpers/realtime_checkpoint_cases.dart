part of '../realtime_controller_on_device_translation_test.dart';

void checkpointCases() {
  test('tail deadline rejects late MT even while final storage is still waiting', () async {
    var stall = false;
    final release = Completer<void>();
    final translator = _DeferredTranslationProvider();
    final h = _CheckpointHarness(translator: translator, beforeReplace: () async {
      if (stall) await release.future;
    });
    addTearDown(h.close);
    await h.controller.start();
    h.emit('a', '已确认原文', 1);
    await h.drain();
    stall = true;
    final stopped = h.controller.stop();
    await h.repo.preparing.future;
    translator.result.complete(const MobileTranslationResult(text: 'late after deadline', provider: 'fake'));
    await pumpEventQueue();
    expect(h.controller.segments.single.translatedText, isEmpty);
    release.complete();
    await stopped;
    expect((await h.store.getSession(h.repo.id!)).segments.single.translatedText, isEmpty);
    expect(h.speaker.spoken, isEmpty);
  });
  test(
      'original controller checkpoints confirmed text/TTS and pauses/ends in the same history',
      () async {
    final h = _CheckpointHarness();
    addTearDown(h.close);
    await h.controller.start();
    await h.drain();
    h.emit('a', '会议既要', 1, finalValue: false);
    await h.drain();
    expect((await h.store.getSession(h.repo.id!)).segments, isEmpty);
    h.emit('a', '会议既要', 2);
    await h.drain();
    final saved = await LocalSessionStore(file: h.file).getSession(h.repo.id!);
    expect(saved.status, 'checkpoint');
    expect(saved.mode, 'meeting');
    expect(saved.sourceLanguage, 'zh');
    expect(saved.targetLanguage, 'en');
    expect(saved.segments.single.sourceText, '会议纪要');
    expect(saved.segments.single.translatedText, 'Meeting minutes');
    expect(saved.segments.single.refinement!['speechTiming'],
        containsPair('status', 'finished'));
    expect(h.speaker.spoken, hasLength(1));
    await h.controller.pause();
    expect(
        (await h.store.loadCheckpoints(
                deploymentId: deviceLocalDeployment, ownerId: deviceLocalOwner))
            .single
            .snapshot!
            .status,
        'paused');
    expect(
        await h.file.exists(), isFalse); // no new session copied into old JSON
    await h.controller.start();
    await h.drain();
    h.emit('repeat', '会议纪要', 1);
    await h.drain();
    await h.controller.stop();
    final ended = await h.store.getSession(h.repo.id!);
    expect(ended.status, 'ended');
    expect(ended.segments, hasLength(2));
    expect(ended.segments.first.rawText, '会议既要');
    expect(
        (await h.store.loadCheckpoints(
                deploymentId: deviceLocalDeployment, ownerId: deviceLocalOwner))
            .single
            .pending,
        isEmpty);
    final bytes = await h.v3.readAsBytes();
    await h.repo.end(h.repo.id!, h.controller.segments);
    expect(await h.v3.readAsBytes(), bytes);
    final restarted =
        LocalRealtimeRepository(store: LocalSessionStore(file: h.file));
    addTearDown(restarted.dispose);
    await restarted.recoverPendingFinalizations();
    await expectLater(restarted.end(h.repo.id!, []), throwsStateError);
    expect(await h.v3.readAsBytes(),
        bytes); // reopening did not resume/finalize/upload
  });

  test(
      'disk failure reports warning, preserves earlier snapshot, then a new commit retries',
      () async {
    var fail = false;
    final h = _CheckpointHarness(beforeReplace: () async {
      if (fail) throw const FileSystemException('injected disk failure');
    });
    addTearDown(h.close);
    await h.controller.start();
    h.emit('a', '第一句', 1);
    await h.drain();
    final bytes = await h.v3.readAsBytes();
    fail = true;
    h.emit('b', '第二句', 2);
    await h.drain(ignoreError: true);
    expect(h.controller.message, contains('快照保存未确认'));
    expect(await h.v3.readAsBytes(), bytes);
    fail = false;
    h.emit('c', '第三句', 3);
    await h.drain();
    expect((await h.store.getSession(h.repo.id!)).segments, hasLength(3));
    expect(h.controller.message, isNull);
    await h.controller.stop();
  });

  test(
      'deleting a saved live checkpoint prevents later capture and stop from resurrecting it',
      () async {
    final h = _CheckpointHarness();
    addTearDown(h.close);
    await h.controller.start();
    h.emit('a', '已提交', 1);
    await h.drain();
    await h.store.deleteSession(h.repo.id!);
    h.emit('b', '迟到结果', 2);
    await h.drain(ignoreError: true);
    await h.controller.stop();
    expect(h.controller.status, RealtimeStatus.ended);
    expect(h.controller.message, contains('结束保存未确认'));
    expect(await h.store.listSessions(), isEmpty);
    await expectLater(h.store.getSession(h.repo.id!),
        throwsA(isA<LocalSessionNotFoundException>()));
  });

  test('stop has bounded translation tail and never commits late MT after end',
      () async {
    final translator = _DeferredTranslationProvider();
    final h = _CheckpointHarness(translator: translator);
    addTearDown(h.close);
    await h.controller.start();
    h.emit('a', '正在处理', 1);
    await h.drain();
    final watch = Stopwatch()..start();
    await h.controller.stop();
    expect(watch.elapsed, lessThan(const Duration(seconds: 5)));
    expect(h.controller.message, contains('尾句处理未完整确认'));
    final bytes = await h.v3.readAsBytes();
    translator.result.complete(
        const MobileTranslationResult(text: 'late', provider: 'fake'));
    await pumpEventQueue();
    expect(await h.v3.readAsBytes(), bytes);
    expect(h.speaker.spoken, isEmpty);
  });
  test(
      'stop returns with an honest warning while disk is stalled, without restarting audio',
      () async {
    final entered = Completer<void>(), release = Completer<void>();
    final h = _CheckpointHarness(beforeReplace: () async {
      if (!entered.isCompleted) {
        entered.complete();
        await release.future;
      }
    });
    addTearDown(h.close);
    await h.controller.start();
    await entered.future;
    final watch = Stopwatch()..start();
    await h.controller.stop();
    expect(watch.elapsed, lessThan(const Duration(seconds: 5)));
    expect(h.controller.status, RealtimeStatus.ended);
    expect(h.controller.message, contains('结束保存未确认'));
    expect(h.speaker.stopCount, greaterThan(0));
    expect(h.speaker.spoken, isEmpty);
    release.complete();
    await h.repo.end(h.repo.id!, h.controller.segments);
    expect((await h.store.getSession(h.repo.id!)).status, 'ended');
  });
}

class _ObservedCheckpointRepository extends LocalRealtimeRepository {
  _ObservedCheckpointRepository(LocalSessionStore store) : super(store: store);
  String? id;
  Future<void>? lastWrite;
  final preparing = Completer<void>();
  @override
  Future<void> prepareFinalization(String sessionId, List<SubtitleSegment> segments,
      {int? billableSeconds}) {
    if (!preparing.isCompleted) preparing.complete();
    return super.prepareFinalization(sessionId, segments, billableSeconds: billableSeconds);
  }
  @override
  Future<RealtimeSession> startSession() async {
    final value = await super.startSession();
    id = value.sessionId;
    return value;
  }

  @override
  Future<void> checkpoint(String sessionId, List<SubtitleSegment> segments,
      {required String mode,
      required String status,
      required String sourceLanguage,
      required String targetLanguage,
      required int activeSeconds}) {
    return lastWrite = super.checkpoint(sessionId, segments,
        mode: mode,
        status: status,
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage,
        activeSeconds: activeSeconds);
  }
}

class _CheckpointHarness {
  _CheckpointHarness(
      {Future<void> Function()? beforeReplace,
      MobileTranslationProvider? translator}) {
    store =
        LocalSessionStore(file: file, checkpointBeforeReplace: beforeReplace);
    repo = _ObservedCheckpointRepository(store);
    controller = RealtimeController(
        repository: repo,
        audioCapture: _NoopAudioCapture(),
        mobileAsrProvider: asr,
        mobileTranslationProvider:
            translator ?? _FakeTranslationProvider('Meeting minutes'),
        speechOutputProvider: speaker,
        autoSpeakTranslation: true,
        config: AppConfig(
            apiBaseUrl: Uri.parse('http://127.0.0.1:1'),
            useMockAudio: false,
            useDeviceAsr: true,
            useLocalSessions: true,
            useOnDeviceTranslation: true,
            sourceLanguage: 'zh',
            targetLanguage: 'en',
            autoReverseTargetLanguage: false,
            deviceAsrProvider: 'apple_speech_transcriber',
            deviceAsrLanguage: 'zh',
            deviceAsrAutoDownloadModel: false,
            deviceAsrModelChunkMs: 32,
            serverOwnedHistory: false,
            realtimeMode: 'meeting'));
  }
  final directory =
      Directory.systemTemp.createTempSync('checkpoint-controller-');
  late final file = File('${directory.path}/legacy.json');
  File get v3 => File('${file.path}.checkpoints-v3.json');
  final asr = _FakeMobileAsrProvider();
  final speaker = FakeSpeechOutputProvider();
  late final LocalSessionStore store;
  late final _ObservedCheckpointRepository repo;
  late final RealtimeController controller;
  void emit(String id, String text, int revision, {bool finalValue = true}) =>
      asr.emit(AsrTextSegment(
          id: id,
          text: text,
          language: 'zh',
          isFinal: finalValue,
          revision: revision,
          captureId: asr.lastConfig!.captureId,
          languagePolicyKey: asr.lastConfig!.languagePolicyKey,
          languageEvidence: AsrLanguageEvidence.userSelected));
  Future<void> drain({bool ignoreError = false}) async {
    await pumpEventQueue();
    try {
      await repo.lastWrite;
    } catch (_) {
      if (!ignoreError) rethrow;
    }
    await pumpEventQueue();
  }

  Future<void> close() async {
    await controller.disposeAsync();
    controller.dispose();
    await pumpEventQueue();
    directory.deleteSync(recursive: true);
  }
}
