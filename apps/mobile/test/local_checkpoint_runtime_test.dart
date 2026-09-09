import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/realtime/data/local_realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/shared/domain/speaker_attribution.dart';

void main() {
  late Directory directory;
  late File legacy;
  setUp(() {
    directory = Directory.systemTemp.createTempSync('checkpoint-runtime-');
    legacy = File('${directory.path}/legacy.json');
  });
  tearDown(() => directory.deleteSync(recursive: true));

  test(
      'slow disk coalesces 200 updates into one in-flight and one latest snapshot',
      () async {
    final entered = Completer<void>(), release = Completer<void>();
    var writes = 0;
    final store = LocalSessionStore(
        file: legacy,
        checkpointBeforeReplace: () async {
          writes++;
          if (writes == 1) {
            entered.complete();
            await release.future;
          }
        });
    final repo = LocalRealtimeRepository(store: store);
    addTearDown(repo.dispose);
    final session = await repo.startSession();
    Future<void> save(int index) => repo.checkpoint(
        session.sessionId,
        [
          SubtitleSegment(
              id: 's',
              sourceText: 'source-$index',
              translatedText: 'target-$index')
        ],
        mode: 'classroom',
        status: 'active',
        sourceLanguage: 'fr',
        targetLanguage: 'ja',
        activeSeconds: index);
    final first = save(1);
    await entered.future;
    for (var i = 2; i <= 201; i++) {
      expect(identical(save(i), first), isTrue);
    }
    release.complete();
    await first;
    expect(writes, 2);
    final detail =
        await LocalSessionStore(file: legacy).getSession(session.sessionId);
    expect(detail.mode, 'classroom');
    expect(detail.status, 'checkpoint');
    expect(detail.segments.single.sourceText, 'source-201');
    expect(detail.consumedSeconds, 201);
    expect(await legacy.exists(), isFalse);
  });

  test(
      'v3 history coexists with legacy without copying it and preserves edit/export semantics',
      () async {
    final store = LocalSessionStore(file: legacy);
    await store.saveEndedSession(
        sessionId: 'old',
        createdAt: DateTime.utc(2026),
        segments: const [
          SubtitleSegment(
              id: 'old-s', sourceText: '旧数据', translatedText: 'legacy')
        ]);
    final oldBytes = await legacy.readAsBytes();
    await store.putCheckpoint(LocalSessionCheckpoint(
        deploymentId: deviceLocalDeployment,
        ownerId: deviceLocalOwner,
        revision: 1,
        snapshot: SessionDetail(
            sessionId: 'v3',
            mode: 'business',
            status: 'ended',
            createdAt: DateTime.utc(2026, 9, 8),
            endedAt: DateTime.utc(2026, 9, 8, 0, 0, 5),
            consumedSeconds: 5,
            segmentCount: 1,
            reviewJson: const {
              'actionItems': [
                {'text': 'Review', 'completed': false}
              ]
            },
            segments: const [
              SessionSegment(
                  id: 's',
                  sourceText: '会议纪要',
                  rawText: '会议既要',
                  optimizedText: '会议纪要',
                  translatedText: 'Minutes',
                  refinement: {
                    'speechTiming': {'nativeRequestToStartMs': 100}
                  },
                  speaker: SpeakerAttribution(
                      speakerId: 'speaker-1',
                      role: 'speaker',
                      source: 'manual'))
            ])));
    expect((await store.listSessions()).map((s) => s.sessionId).toSet(),
        {'old', 'v3'});
    await store.renameSpeaker('v3', 'speaker-1', '张三');
    await store.updateActionItem('v3', 0, true);
    final detail = await LocalSessionStore(file: legacy).getSession('v3');
    expect(detail.segments.single.speaker!.displayName, '张三');
    expect(detail.reviewJson!['actionItems'], [
      {'text': 'Review', 'completed': true}
    ]);
    expect((await store.exportSession('v3', format: 'json')).content,
        contains('nativeRequestToStartMs'));
    await store.deleteSession('v3');
    expect((await store.listSessions()).single.sessionId, 'old');
    expect(await legacy.readAsBytes(), oldBytes);
  });
}
