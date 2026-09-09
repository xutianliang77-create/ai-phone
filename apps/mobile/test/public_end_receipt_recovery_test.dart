import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'public_session_lifecycle_test.dart' as fixture;

class LossHarness extends fixture.Harness {
  bool loseFinalReply = true, loseRecoveryReply = false;
  fixture.Gateway? rebuiltGateway;
  final paths = <String>[];
  @override
  Future<http.Response> handle(http.Request request) async {
    paths.add(request.url.path);
    if (request.url.path.endsWith('/recovery') && loseRecoveryReply) {
      throw http.ClientException('Synthetic recovery response lost');
    }
    final result = await super.handle(request);
    if (request.url.path.endsWith('/finalize') && loseFinalReply) {
      already = true; // Synthetic server committed before transport failed.
      throw http.ClientException('Synthetic committed finalize response lost');
    }
    return result;
  }
  RecoveryApi rebuild() {
    repo.dispose();
    final next = RecoveryApi(MockClient(handle), accounts);
    api = next;
    store = LocalSessionStore(file: File('${directory.path}/old.json'));
    rebuiltGateway = fixture.Gateway();
    repo = RealtimeRepository(apiClient: next,
        gatewayClient: rebuiltGateway!, resultSyncStore: store);
    return next;
  }
}

class RecoveryApi extends fixture.Api {
  RecoveryApi(super.client, super.accounts);
  int creates = 0;
  @override
  Future<RealtimeSession> createSession() async {
    creates++;
    return super.createSession();
  }
}

void main() {
  test('lost final ACK keeps durable tail; rebuilt client confirms original receipt without another POST or connection', () async {
    final h = LossHarness();addTearDown(h.close);
    await h.repo.startSession();
    await expectLater(h.repo.finishPublicSession(fixture.session, fixture.segments,
        mode: 'meeting'), throwsA(isA<http.ClientException>()));
    final before = (await h.records()).single;
    expect(before.pending, hasLength(1));expect(before.snapshot!.status, 'ending');
    expect(before.snapshot!.segments.single.sourceText, '原文');
    expect(before.snapshot!.segments.single.translatedText, 'Translation');
    final api = h.rebuild();final calls = h.posts.length;
    final result = await h.repo.confirmPendingPublicFinalizations();
    expect(result, (confirmed: 1, pending: 0));
    final saved = (await h.records()).single;
    expect(saved.sessionId, before.sessionId);expect(saved.snapshot!.mode, 'meeting');
    expect(saved.snapshot!.segments.single.sourceText, '原文');
    expect(saved.snapshot!.segments.single.translatedText, 'Translation');
    expect(saved.snapshot!.consumedSeconds, 12);expect(saved.snapshot!.status, 'ended');
    expect(saved.pending, isEmpty);expect(api.creates, 0);expect(h.posts.length, calls);
    expect(await h.repo.confirmPendingPublicFinalizations(), (confirmed: 0, pending: 0));
    expect(h.posts, hasLength(1));expect(h.gateway.connects, 1);expect(h.gateway.resumes, 0);
    expect(h.rebuiltGateway!.connects, 0);expect(h.rebuiltGateway!.resumes, 0);expect(h.rebuiltGateway!.ends, 0);
  });
  test('recovery HTTP loss leaves the exact pending checkpoint and retries only after explicit request', () async {
    final h = LossHarness();addTearDown(h.close);await h.repo.startSession();
    await expectLater(h.repo.finishPublicSession(fixture.session, fixture.segments,
        mode: 'conversation'), throwsA(anything));
    h.rebuild();final before=(await h.records()).single.toJson();h.loseRecoveryReply=true;
    expect(await h.repo.confirmPendingPublicFinalizations(),(confirmed:0,pending:1));
    expect((await h.records()).single.toJson(),before);expect(h.posts,hasLength(1));
    h.loseRecoveryReply=false;
    expect(await h.repo.confirmPendingPublicFinalizations(),(confirmed:1,pending:0));expect(h.posts,hasLength(1));
  });
  test('another account cannot recover the original pending end; original owner can return and confirm', () async {
    final h=LossHarness();addTearDown(h.close);await h.repo.startSession();
    await expectLater(h.repo.finishPublicSession(fixture.session,fixture.segments,mode:'conversation'),throwsA(anything));
    h.rebuild();await h.accounts.save(fixture.account('other'));final count=h.paths.length;
    expect(await h.repo.confirmPendingPublicFinalizations(),(confirmed:0,pending:0));expect(h.paths.length,count);
    expect((await h.records()).single.pending,hasLength(1));await h.accounts.save(fixture.account());
    expect(await h.repo.confirmPendingPublicFinalizations(),(confirmed:1,pending:0));
  });
}
