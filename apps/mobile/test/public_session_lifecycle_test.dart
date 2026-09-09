import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';

void main() {
  test(
      'saves end intent before HTTP, uses server watermark and confirms only the bound receipt',
      () async {
    final h = Harness();
    addTearDown(h.close);
    await h.repo.startSession();
    expect(await h.repo.finishPublicSession(session, segments, mode: 'meeting'),
        isTrue);
    final body = h.posts.single;
    expect(body['stopWatermark'], watermark);
    expect(body.containsKey('billableSeconds'), isFalse);
    expect(body.containsKey('segments'), isFalse);
    expect(body['idempotencyKey'], 'finalize:public-s');
    final saved = (await h.records()).single;
    expect(saved.snapshot!.status, 'ended');
    expect(saved.snapshot!.consumedSeconds, 12);
    expect(saved.snapshot!.mode, 'meeting');
    expect(saved.pending, isEmpty);
    expect(h.gateway.ends, 1);
    expect(h.posts.length, 1);
  });
  test(
      'missing proof stays pending; explicit restart recovery never reconnects or creates a new session',
      () async {
    final h = Harness()..ready = false;
    addTearDown(h.close);
    await h.repo.startSession();
    expect(
        await h.repo
            .finishPublicSession(session, segments, mode: 'conversation'),
        isFalse);
    expect((await h.records()).single.pending.single.kind,
        CheckpointOperationKind.finalize);
    expect(h.posts, isEmpty);
    h.ready = true;
    final gateway = Gateway();
    final restarted = RealtimeRepository(
        apiClient: h.api, gatewayClient: gateway, resultSyncStore: h.store);
    final result = await restarted.confirmPendingPublicFinalizations();
    expect(result.confirmed, 1);
    expect(result.pending, 0);
    expect(gateway.connects, 0);
    expect(gateway.resumes, 0);
    final repeated = await restarted.confirmPendingPublicFinalizations();
    expect(repeated.confirmed, 0);
    expect(h.posts.length, 1);
    restarted.dispose();
  });
  for (final error in ['wrong-watermark', 'wrong-owner', 'wrong-seconds']) {
    test('$error cannot clear the durable end intent', () async {
      final h = Harness()..bad = error;
      addTearDown(h.close);
      await h.repo.startSession();
      await expectLater(
          h.repo.finishPublicSession(session, segments, mode: 'conversation'),
          throwsA(anything));
      expect((await h.records()).single.pending, hasLength(1));
    });
  }
  test(
      'logout during final receipt leaves pending, and the new owner cannot replay it',
      () async {
    final h = Harness();
    addTearDown(h.close);
    await h.repo.startSession();
    h.delay = Completer<http.Response>();
    final pending =
        h.repo.finishPublicSession(session, segments, mode: 'conversation');
    final result = expectLater(pending, throwsA(anything));
    await h.posted.future;
    await h.accounts.clear();
    await h.accounts.save(account('other'));
    h.delay!.complete(h.response(ack()));
    await result;
    expect((await h.records()).single.pending, hasLength(1));
    final next = await h.repo.confirmPendingPublicFinalizations();
    expect(next.confirmed, 0);
    expect(h.posts.length, 1);
  });
  test('recovery denial never invokes Gateway resume or creates a replacement',
      () async {
    final h = Harness();
    addTearDown(h.close);
    await h.repo.startSession();
    h.resume = false;
    expect(await h.repo.resumeAfterLifecycle('public-s'), isFalse);
    expect(h.gateway.resumes, 0);
    h.resume = true;
    expect(await h.repo.resumeAfterLifecycle('public-s'), isTrue);
    expect(h.gateway.resumes, 1);
    expect(h.gateway.connects, 1);
    expect(h.posts, isEmpty);
    h.gateway.retained = false;
    expect(await h.repo.resumeAfterLifecycle('public-s'), isFalse);
    expect(h.gateway.resumes, 1);
  });
  test('same-connection resume uses current server permission, not handshake token expiry', () async {
    final h = Harness();addTearDown(h.close);
    h.api.returnedSession = RealtimeSession(sessionId: session.sessionId, realtimeToken: session.realtimeToken,
      endpoint: session.endpoint, expiresAt: DateTime.now().subtract(const Duration(seconds: 1)), maxDurationSeconds: session.maxDurationSeconds, syncBinding: session.syncBinding);
    await h.repo.startSession();h.resume = true;
    expect(await h.repo.resumeAndWait('public-s'), isTrue);expect(h.gateway.resumes, 1);
  });
  test('text-sync revocation preserves a pending finalization operation',
      () async {
    final h = Harness()..ready = false;
    addTearDown(h.close);
    await h.repo.startSession();
    await h.repo.finishPublicSession(session, segments, mode: 'conversation');
    await h.store.clearCheckpointSync(
        deploymentId: 'public-test', ownerId: 'owner', sessionId: 'public-s');
    final saved = (await h.records()).single;
    expect(saved.pending.single.kind, CheckpointOperationKind.finalize);
    expect(saved.pending.single.revision, saved.revision);
    expect(saved.snapshot!.segments.single.sourceText, '原文');
  });
  test(
      'already-issued server receipt can be confirmed without another finalize POST',
      () async {
    final h = Harness()..already = true;
    addTearDown(h.close);
    await h.repo.startSession();
    expect(
        await h.repo
            .finishPublicSession(session, segments, mode: 'conversation'),
        isTrue);
    expect(h.posts, isEmpty);
  });
}

const watermark = {
  'captureId': 'capture',
  'languagePolicyKey': 'policy:1',
  'finalRevision': 4,
  'lastAcceptedSample': 32000
};
const segments = [
  SubtitleSegment(
      id: 'seg',
      revision: 4,
      sourceText: '原文',
      translatedText: 'Translation',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      stage: 'translation')
];
final session = RealtimeSession(
    sessionId: 'public-s',
    realtimeToken: 'synthetic',
    endpoint: Uri.parse('wss://public.test/realtime'),
    expiresAt: DateTime.utc(2099),
    maxDurationSeconds: 120,
    syncBinding: const ResultSyncBinding(
        deploymentId: 'public-test',
        ownerId: 'owner',
        modelPolicyRevision: 'policy-v1'));
AccountSession account([String owner = 'owner']) => AccountSession(
    token: 'synthetic-$owner',
    expiresAtIso: '2099-01-01T00:00:00Z',
    deploymentId: 'public-test',
    ownerId: owner,
    issuerOrigin: 'https://public.test');
Map<String, Object?> ack() => {
      'operation': 'finalize',
      'contractVersion': 1,
      'sessionId': 'public-s',
      'deploymentId': 'public-test',
      'ownerId': 'owner',
      'modelPolicyRevision': 'policy-v1',
      'idempotencyKey': 'finalize:public-s',
      'status': 'ended',
      'consumedSeconds': 12,
      'meterBasis': 'server_observed_active_ms',
      'stopWatermark': watermark,
      'createdAt': '2026-09-08T00:00:00Z',
      'endedAt': '2026-09-08T00:00:12Z',
      'finalizedAt': '2026-09-08T00:00:12Z'
    };

class Api extends RealtimeApiClient {
  RealtimeSession returnedSession = session;
  Api(http.Client client, AccountSessionStore accounts)
      : super(
            baseUrl: Uri.parse('https://public.test'),
            publicDeploymentId: 'public-test',
            client: client,
            accountSessionStore: accounts);
  @override
  Future<RealtimeSession> createSession() async => returnedSession;
}

class Gateway extends RealtimeGatewayClient {
  int connects = 0, ends = 0, resumes = 0;
  bool retained = true;
  @override
  bool canResumePublicTransport(String id) => retained && id == 'public-s';
  @override
  Future<bool> resumeAndWait(String id, {Duration timeout = const Duration(seconds: 12)}) async { resumes++;return true; }
  @override
  Future<void> connect(RealtimeSession session) async {
    connects++;
  }

  @override
  Future<bool> endAndWait(String id,
      {Duration timeout = const Duration(seconds: 1)}) async {
    ends++;
    return true;
  }

  @override
  Future<bool> reconnectAndResume(String id,
      {Duration timeout = const Duration(seconds: 12)}) async {
    resumes++;
    return true;
  }
}

class Harness {
  Harness() {
    store = LocalSessionStore(file: File('${directory.path}/old.json'));
    api = Api(MockClient(handle), accounts);
    repo = RealtimeRepository(
        apiClient: api, gatewayClient: gateway, resultSyncStore: store);
  }
  final directory = Directory.systemTemp.createTempSync('public-lifecycle-');
  final accounts = MemoryAccountSessionStore(account());
  final gateway = Gateway();
  late LocalSessionStore store;
  late Api api;
  late RealtimeRepository repo;
  bool ready = true, resume = false, already = false;
  String? bad;
  Completer<http.Response>? delay;
  final posted = Completer<void>();
  final posts = <Map<String, Object?>>[];
  Future<http.Response> handle(http.Request request) async {
    expect(request.followRedirects, isFalse);
    if (request.url.path == '/auth/deployment') {
      return response({'deploymentId': 'public-test'});
    }
    expect(request.headers['authorization'], 'Bearer synthetic-owner');
    if (request.url.path.endsWith('/recovery')) {
      return response({
        'contractVersion': 1,
        'sessionId': 'public-s',
        'deploymentId': 'public-test',
        'ownerId': 'owner',
        'modelPolicyRevision': 'policy-v1',
        'canResume': resume,
        'canFinalize': ready,
        'meterStatus': ready ? 'verified' : 'missing',
        'recoveryUntil': '2099-01-01T00:00:00Z',
        if (ready) 'stopWatermark': watermark,
        if (already) 'finalization': ack()
      });
    }
    expect(request.url.path.endsWith('/finalize'), isTrue);
    expect((await records()).single.pending, hasLength(1));
    posts.add(jsonDecode(request.body) as Map<String, Object?>);
    if (!posted.isCompleted) posted.complete();
    if (delay != null) return delay!.future;
    final result = ack();
    if (bad == 'wrong-watermark') {
      result['stopWatermark'] = {...watermark, 'lastAcceptedSample': 0};
    }
    if (bad == 'wrong-owner') result['ownerId'] = 'wrong';
    if (bad == 'wrong-seconds') result['consumedSeconds'] = -1;
    return response(result);
  }

  http.Response response(Object body) => http.Response(jsonEncode(body), 200,
      headers: {'content-type': 'application/json; charset=utf-8'});
  Future<List<LocalSessionCheckpoint>> records() =>
      store.loadCheckpoints(deploymentId: 'public-test', ownerId: 'owner');
  void close() {
    repo.dispose();
    directory.deleteSync(recursive: true);
  }
}
