import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'public_session_lifecycle_test.dart' as fixture;

class TailGateway extends fixture.Gateway {
  final stopping = Completer<void>();
  final flushed = Completer<bool>();
  int closes = 0;
  @override
  Future<bool> endAndWait(String id, {Duration timeout = const Duration(seconds: 1)}) {
    stopping.complete();
    return flushed.future;
  }
  @override
  Future<void> close() async { closes++; }
}

const draft = SubtitleSegment(id: 'tail', revision: 1, sourceText: '尾句',
    translatedText: '', sourceLanguage: 'zh', targetLanguage: 'en', stage: 'asr');
const translated = SubtitleSegment(id: 'tail', revision: 1, sourceText: '尾句',
    translatedText: 'Tail sentence.', sourceLanguage: 'zh', targetLanguage: 'en', stage: 'translation');

Future<({fixture.Harness h, TailGateway gateway})> setup() async {
  final h = fixture.Harness();
  addTearDown(h.close);
  h.repo.dispose();
  final gateway = TailGateway();
  h.repo = RealtimeRepository(apiClient: h.api, gatewayClient: gateway, resultSyncStore: h.store);
  await h.repo.startSession();
  return (h: h, gateway: gateway);
}

void main() {
  test('flush tail replaces the early checkpoint before receipt confirmation', () async {
    final t = await setup(), captions = [draft];
    final ending = t.h.repo.finishPublicSession(fixture.session, captions, mode: 'conversation');
    await t.gateway.stopping.future;
    expect((await t.h.records()).single.snapshot!.segments.single.translatedText, '');
    captions[0] = translated;
    t.gateway.flushed.complete(true);
    expect(await ending, isTrue);
    final saved = (await t.h.records()).single;
    expect(saved.snapshot!.segments.single.translatedText, 'Tail sentence.');
    expect(saved.snapshot!.status, 'ended');
    expect(saved.pending, isEmpty);
    expect(t.h.posts, hasLength(1));
  });
  test('replaced controller list includes a newly flushed segment', () async {
    final t = await setup();
    var captions = <SubtitleSegment>[draft];
    final ending = t.h.repo.finishPublicSession(fixture.session, captions,
        mode: 'conversation', currentSegments: () => captions);
    await t.gateway.stopping.future;
    captions = [translated, ...fixture.segments];
    t.gateway.flushed.complete(true);
    expect(await ending, isTrue);
    final saved = (await t.h.records()).single.snapshot!;
    expect(saved.segmentCount, 2);
    expect(saved.segments.map((s) => s.translatedText), ['Tail sentence.', 'Translation']);
  });
  test('missing end proof retains the newest tail and original finalize identity', () async {
    final t = await setup();
    t.h.ready = false;
    final ending = t.h.repo.finishPublicSession(fixture.session, [draft],
        mode: 'conversation', currentSegments: () => [translated]);
    await t.gateway.stopping.future;
    t.gateway.flushed.complete(false);
    expect(await ending, isFalse);
    final pending = (await t.h.records()).single;
    expect(pending.snapshot!.segments.single.translatedText, 'Tail sentence.');
    expect(pending.pending.single.opId, 'finalize:public-s');
    expect(pending.pending.single.revision, pending.revision);
    expect(t.h.posts, isEmpty);
    t.h.ready = true;
    expect(await t.h.repo.confirmPendingPublicFinalizations(), (confirmed: 1, pending: 0));
    expect(t.h.posts, hasLength(1));
  });
  test('account change during flush cannot read another controller list or confirm', () async {
    final t = await setup();
    var calls = 0;
    final ending = t.h.repo.finishPublicSession(fixture.session, [draft],
        mode: 'conversation', currentSegments: () { calls++; return [translated]; });
    await t.gateway.stopping.future;
    await t.h.accounts.save(fixture.account('other'));
    t.gateway.flushed.complete(true);
    expect(await ending, isFalse);
    expect(calls, 0);
    expect(t.gateway.closes, 0);
    expect(t.h.posts, isEmpty);
    expect((await t.h.records()).single.snapshot!.status, 'ending');
  });
  test('a new session generation cannot replace the old ending record', () async {
    final t = await setup();
    final ending = t.h.repo.finishPublicSession(fixture.session, [draft],
        mode: 'conversation', currentSegments: () => [translated]);
    await t.gateway.stopping.future;
    t.h.repo.invalidateResultSync();
    t.gateway.flushed.complete(true);
    expect(await ending, isFalse);
    expect(t.h.posts, isEmpty);
    expect((await t.h.records()).single.snapshot!.segments.single.translatedText, '');
  });
  test('deleted history cannot be resurrected by the flush tail', () async {
    final t = await setup();
    final ending = t.h.repo.finishPublicSession(fixture.session, [draft],
        mode: 'conversation', currentSegments: () => [translated]);
    await t.gateway.stopping.future;
    final old = (await t.h.records()).single;
    await t.h.store.putCheckpoint(LocalSessionCheckpoint.tombstone(
        deploymentId: old.deploymentId, ownerId: old.ownerId,
        sessionId: old.sessionId, revision: old.revision + 1, reason: 'deleted'));
    t.gateway.flushed.complete(true);
    await expectLater(ending, throwsA(anything));
    expect((await t.h.records()).single.tombstone, isNotNull);
    expect(t.h.posts, isEmpty);
  });
}
