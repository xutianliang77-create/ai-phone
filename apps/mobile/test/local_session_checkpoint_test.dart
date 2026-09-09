import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/realtime/data/finalization/realtime_finalization_outbox.dart';
import 'package:translation_mobile/src/features/realtime/data/finalization/realtime_finalization_task.dart';

void main() {
  late Directory directory;
  late File legacy, v3;
  late LocalSessionStore store;
  setUp(() {
    directory = Directory.systemTemp.createTempSync('wujie-checkpoint-');
    legacy = File('${directory.path}/sessions.json');
    v3 = File('${legacy.path}.checkpoints-v3.json');
    store = LocalSessionStore(file: legacy);
  });
  tearDown(() => directory.deleteSync(recursive: true));
  Future<List<LocalSessionCheckpoint>> load(
          [String owner = 'owner-a', String deployment = 'public-a']) =>
      LocalSessionStore(file: legacy)
          .loadCheckpoints(deploymentId: deployment, ownerId: owner);

  test(
      'v3 round-trip preserves business mode, layers, pending and timing together',
      () async {
    final record = checkpoint();
    expect(await store.putCheckpoint(record), isTrue);
    final actual = (await load()).single;
    expect(actual.toJson(), record.toJson());
    expect(actual.snapshot!.mode, 'listen');
    expect(actual.snapshot!.sourceLanguage, 'fr');
    expect(actual.snapshot!.targetLanguage, 'ja');
    expect(actual.snapshot!.segments.single.rawText, 'raw');
    expect(actual.snapshot!.segments.single.refinement!['speechTiming'],
        {'queueWaitMs': 1.25});
    expect(actual.pending.single.kind, CheckpointOperationKind.sync);
    expect(await legacy.exists(), isFalse);
    expect(jsonDecode(await v3.readAsString())['version'], 3);
  });
  test('concurrent store instances do not lose unrelated sessions', () async {
    await Future.wait(List.generate(
        20,
        (i) => LocalSessionStore(file: legacy)
            .putCheckpoint(checkpoint(id: 's$i'))));
    expect(await load(), hasLength(20));
  });
  test('explicit owner and deployment scopes isolate identical session ids',
      () async {
    await store.putCheckpoint(checkpoint());
    await store.putCheckpoint(checkpoint(owner: 'owner-b'));
    await store.putCheckpoint(checkpoint(deployment: 'private-a'));
    expect(await load(), hasLength(1));
    expect(await load('owner-b'), hasLength(1));
    expect(await load('owner-a', 'private-a'), hasLength(1));
    expect(await load('unrelated'), isEmpty);
    await expectLater(store.loadCheckpoints(deploymentId: '', ownerId: 'a'),
        throwsArgumentError);
  });
  test('idempotent writes, stale revision and equal-revision conflicts',
      () async {
    await store.putCheckpoint(checkpoint(revision: 2));
    final bytes = await v3.readAsBytes();
    expect(await store.putCheckpoint(checkpoint(revision: 2)), isFalse);
    await expectLater(store.putCheckpoint(checkpoint()), throwsStateError);
    await expectLater(
        store.putCheckpoint(checkpoint(revision: 2, text: 'changed')),
        throwsStateError);
    expect(await v3.readAsBytes(), bytes);
  });
  test(
      'old/wrong-scope ACK does not erase new pending content; duplicate ACK is inert',
      () async {
    await store.putCheckpoint(checkpoint());
    await store.putCheckpoint(checkpoint(revision: 2, text: 'new'));
    Future<bool> ack(
            {int revision = 2,
            String owner = 'owner-a',
            String op = 'sync-s'}) =>
        store.acknowledgeCheckpoint(
            deploymentId: 'public-a',
            ownerId: owner,
            sessionId: 's',
            opId: op,
            revision: revision);
    expect(await ack(revision: 1), isFalse);
    expect(await ack(owner: 'wrong'), isFalse);
    expect(await ack(op: 'different'), isFalse);
    expect((await load()).single.pending, hasLength(1));
    expect(await ack(), isTrue);
    expect(await ack(), isFalse);
    final actual = (await load()).single;
    expect(actual.pending, isEmpty);
    expect(actual.snapshot!.segments.single.sourceText, 'new');
    await expectLater(store.putCheckpoint(checkpoint(revision: 2, text: 'new')),
        throwsStateError);
    expect((await load()).single.pending,
        isEmpty); // old payload cannot resurrect ACKed work
  });
  for (final reason in ['deleted', 'revoked']) {
    test('$reason tombstone wins over queued work and later writes', () async {
      await store.putCheckpoint(checkpoint());
      final tombstone = LocalSessionCheckpoint.tombstone(
          deploymentId: 'public-a',
          ownerId: 'owner-a',
          sessionId: 's',
          revision: 2,
          reason: reason);
      await store.putCheckpoint(tombstone);
      await expectLater(
          store.putCheckpoint(checkpoint(revision: 3)), throwsStateError);
      expect(
          await store.acknowledgeCheckpoint(
              deploymentId: 'public-a',
              ownerId: 'owner-a',
              sessionId: 's',
              opId: 'sync-s',
              revision: 1),
          isFalse);
      expect(await store.putCheckpoint(tombstone), isFalse);
      expect((await load()).single.snapshot, isNull);
      expect((await load()).single.pending, isEmpty);
      expect(await v3.readAsString(), isNot(contains('optimized')));
    });
  }
  test('ended state cannot reopen and sync does not become finalize', () async {
    await store.putCheckpoint(
        checkpoint(status: 'ended', kind: CheckpointOperationKind.finalize));
    await expectLater(
        store.putCheckpoint(checkpoint(revision: 2)), throwsStateError);
    expect((await load()).single.snapshot!.status, 'ended');
    expect((await load()).single.pending.single.kind,
        CheckpointOperationKind.finalize);
    expect(() => checkpoint(kind: CheckpointOperationKind.finalize),
        throwsFormatException);
  });
  test('input and output mutation cannot change a queued snapshot', () async {
    final record = checkpoint();
    final json = record.toJson();
    (json['snapshot'] as Map)['mode'] = 'changed';
    (json['pending'] as List).clear();
    await store.putCheckpoint(record);
    (record.snapshot!.segments.single.refinement!['speechTiming']
        as Map)['queueWaitMs'] = 999;
    expect((await load()).single.toJson(), checkpoint().toJson());
  });
  test(
      'invalid identity, revision, operation and snapshot metadata fail validation',
      () {
    final good = checkpoint().toJson();
    for (final invalid in [
      {...good, 'ownerId': ''},
      {...good, 'revision': 0},
      {...good, 'revision': '1'},
      {...good, 'unexpected': true},
      {
        ...good,
        'pending': [
          {'opId': 's', 'revision': 2, 'kind': 'sync'}
        ]
      },
      {
        ...good,
        'pending': [
          {'opId': 's', 'revision': 1, 'kind': 'infer'}
        ]
      },
      {
        ...good,
        'snapshot': {...good['snapshot'] as Map, 'segmentCount': 99}
      },
      {
        ...good,
        'snapshot': {...good['snapshot'] as Map, 'sessionId': 'other'}
      },
    ]) {
      expect(() => LocalSessionCheckpoint.fromJson(invalid),
          throwsFormatException);
    }
  });
  test('same-content JSON map key order is idempotent', () async {
    final record = checkpoint();
    await store.putCheckpoint(record);
    final reversed = Map<String, Object?>.fromEntries(
        record.toJson().entries.toList().reversed);
    expect(await store.putCheckpoint(LocalSessionCheckpoint.fromJson(reversed)),
        isFalse);
  });
  test(
      'pre-replace failure keeps committed file and orphan temp is not promoted on restart',
      () async {
    await store.putCheckpoint(checkpoint());
    final bytes = await v3.readAsBytes();
    final failing = LocalSessionStore(
        file: legacy,
        checkpointBeforeReplace: () async {
          throw const FileSystemException('injected before rename');
        });
    await expectLater(failing.putCheckpoint(checkpoint(revision: 2)),
        throwsA(isA<FileSystemException>()));
    expect(await File('${v3.path}.tmp').exists(), isTrue);
    expect(await v3.readAsBytes(), bytes);
    expect((await load()).single.revision, 1);
    await store.putCheckpoint(checkpoint(revision: 3));
    expect((await load()).single.revision, 3);
  });
  test(
      'temporary write I/O failure leaves old record valid and does not report success',
      () async {
    await store.putCheckpoint(checkpoint());
    await Directory('${v3.path}.tmp').create();
    await expectLater(store.putCheckpoint(checkpoint(revision: 2)),
        throwsA(isA<FileSystemException>()));
    expect((await load()).single.revision, 1);
  });
  test('v1/v2 legacy history and finalize outbox bytes remain unchanged',
      () async {
    await legacy.writeAsString('{"sessions":[]}');
    final outboxFile =
        File('${directory.path}/realtime_finalization_outbox.json');
    final outbox = FileRealtimeFinalizationOutbox(file: outboxFile);
    await outbox.upsert(RealtimeFinalizationTask(
        sessionId: 'legacy',
        idempotencyKey: 'finalize:legacy',
        segments: [],
        billableSeconds: 8,
        createdAt: DateTime.utc(2026)));
    final historyBytes = await legacy.readAsBytes(),
        outboxBytes = await outboxFile.readAsBytes();
    await store.putCheckpoint(checkpoint());
    expect(await legacy.readAsBytes(), historyBytes);
    expect(await outboxFile.readAsBytes(), outboxBytes);
    expect((await outbox.load()).single.sessionId, 'legacy');
    expect(await store.listSessions(),
        isEmpty); // no implicit migration or auto-finalize
  });
  for (final bad in [
    'broken',
    '{"version":1,"records":[]}',
    '{"version":2,"records":[]}',
    '{"version":3,"records":[{}]}'
  ]) {
    test('malformed/old checkpoint file fails closed and is preserved: $bad',
        () async {
      await v3.writeAsString(bad);
      await expectLater(store.putCheckpoint(checkpoint()), throwsA(anything));
      expect(await v3.readAsString(), bad);
    });
  }
}

LocalSessionCheckpoint checkpoint(
        {String id = 's',
        int revision = 1,
        String owner = 'owner-a',
        String deployment = 'public-a',
        String text = 'source',
        String status = 'active',
        CheckpointOperationKind kind = CheckpointOperationKind.sync}) =>
    LocalSessionCheckpoint(
        deploymentId: deployment,
        ownerId: owner,
        revision: revision,
        snapshot: SessionDetail(
            sessionId: id,
            mode: 'listen',
            status: status,
            kind: 'realtime',
            consumedSeconds: 12,
            createdAt: DateTime.utc(2026, 9, 8),
            endedAt:
                status == 'ended' ? DateTime.utc(2026, 9, 8, 0, 0, 12) : null,
            sourceLanguage: 'fr',
            targetLanguage: 'ja',
            segmentCount: 1,
            segments: [
              SessionSegment(
                  id: 'seg',
                  sourceText: text,
                  translatedText: 'translation',
                  rawText: 'raw',
                  optimizedText: 'optimized',
                  refinement: const {
                    'speechTiming': {'queueWaitMs': 1.25}
                  })
            ]),
        pending: [
          CheckpointOperation(opId: 'sync-$id', revision: revision, kind: kind)
        ]);
