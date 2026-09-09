import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/app/app_language.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/pages/realtime_page.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_settings_store.dart';
import 'package:translation_mobile/src/features/realtime/data/voice_preset_catalog.dart';
import 'package:translation_mobile/src/platform/audio/audio_capture.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';

part 'helpers/result_sync_ui_cases.dart';

void main() {
  resultSyncUiCases();
  test('failed revocation remains disabled and can be explicitly retried', () async {
    final h=_Harness();addTearDown(h.close);await h.repo.startSession();await h.repo.setResultSyncConsent(true);
    h.failRevoke=true;
    await expectLater(h.repo.setResultSyncConsent(false),throwsA(isA<RealtimeApiException>()));
    expect(h.repo.resultSyncEnabled,isFalse);expect(h.repo.resultSyncRevocationPending,isTrue);
    await expectLater(h.repo.setResultSyncConsent(true),throwsA(isA<RealtimeApiException>()));
    h.failRevoke=false;await h.repo.setResultSyncConsent(false);
    expect(h.repo.resultSyncRevocationPending,isFalse);expect(h.allowed,isFalse);
  });
  test(
      'explicit consent sends no results; manual sync batches 201 completed segments and validates ACKs',
      () async {
    final h = _Harness();
    addTearDown(h.close);
    await h.repo.startSession();
    await expectLater(h.send(), throwsA(isA<RealtimeApiException>()));
    expect(h.requests, isEmpty);
    await h.repo.setResultSyncConsent(true);
    expect(h.syncBodies, isEmpty);
    expect(
        await h.repo.synchronizeResults([
          ...segments(201),
          const SubtitleSegment(
              id: 'draft', sourceText: 'draft', translatedText: '')
        ], mode: 'meeting', activeSeconds: 12),
        201);
    expect(
        h.syncBodies.map((b) => (b['segments'] as List).length), [100, 100, 1]);
    expect((await h.records()).single.pending, isEmpty);
    expect(
        h.requests.every((r) =>
            !r.url.path.endsWith('/end') && !r.url.path.endsWith('/finalize')),
        isTrue);
    expect(h.requests.every((r) => r.followRedirects == false), isTrue);
  });
  test('failed response retains pending; retry keeps the operation identity',
      () async {
    final h = _Harness();
    addTearDown(h.close);
    await h.repo.startSession();
    await h.repo.setResultSyncConsent(true);
    h.failNext = true;
    await expectLater(h.send(), throwsA(isA<RealtimeApiException>()));
    final first = (h.syncBodies.single['sync'] as Map)['opId'];
    expect((await h.records()).single.pending, hasLength(1));
    expect(await h.send(), 1);
    expect((h.syncBodies.last['sync'] as Map)['opId'], first);
    expect((await h.records()).single.pending, isEmpty);
  });
  for (final action in ['logout', 'mode-change', 'aba']) {
    test('$action invalidates a late ACK without clearing pending', () async {
      final h = _Harness();
      addTearDown(h.close);
      await h.repo.startSession();
      await h.repo.setResultSyncConsent(true);
      final response = Completer<http.Response>();
      h.delay = response;
      final pending = h.send();
      final check = expectLater(pending, throwsA(anything));
      await h.requested.future;
      if (action == 'mode-change') {
        h.repo.invalidateResultSync();
      } else {
        await h.accounts.clear();
      }
      if (action == 'aba') await h.accounts.save(account());
      response.complete(h.ack(h.syncBodies.last));
      await check;
      expect((await h.records()).single.pending, hasLength(1));
      expect(h.repo.resultSyncEnabled, isFalse);
    });
  }
  test(
      'revoke clears pending but retains source data, and a late ACK cannot undo it',
      () async {
    final h = _Harness();
    addTearDown(h.close);
    await h.repo.startSession();
    await h.repo.setResultSyncConsent(true);
    final response = Completer<http.Response>();
    h.delay = response;
    final pending = h.send();
    final check = expectLater(pending, throwsA(anything));
    await h.requested.future;
    await h.repo.setResultSyncConsent(false);
    response.complete(h.ack(h.syncBodies.last));
    await check;
    final record = (await h.records()).single;
    expect(record.pending, isEmpty);
    expect(record.snapshot!.segments.single.sourceText, '原文0');
    expect(h.allowed, isFalse);
    expect(h.repo.resultSyncEnabled, isFalse);
  });
  test('credential loss during ACK file commit leaves pending intact',
      () async {
    var writes = 0;
    late _Harness h;
    h = _Harness(beforeReplace: () async {
      if (++writes == 2) await h.accounts.clear();
    });
    addTearDown(h.close);
    await h.repo.startSession();
    await h.repo.setResultSyncConsent(true);
    await expectLater(h.send(), throwsA(anything));
    expect((await h.records()).single.pending, hasLength(1));
  });
  test('public client cannot fall through to private create/save/end/finalize',
      () async {
    var calls = 0;
    final api = RealtimeApiClient(
        baseUrl: Uri.parse('https://sync.test'),
        publicDeploymentId: 'public-test',
        accountSessionStore: MemoryAccountSessionStore(account()),
        client: MockClient((_) async {
          calls++;
          return http.Response('{}', 200);
        }));
    addTearDown(api.close);
    await expectLater(
        api.createSession(), throwsA(isA<RealtimeApiException>()));
    await expectLater(
        api.saveSegments('s', []), throwsA(isA<RealtimeApiException>()));
    await expectLater(
        api.endSession('s'), throwsA(isA<RealtimeApiException>()));
    await expectLater(
        api.finalizeSession(
            sessionId: 's',
            segments: [],
            billableSeconds: 0,
            idempotencyKey: 'finalize:s'),
        throwsA(isA<RealtimeApiException>()));
    expect(calls, 0);
  });
}

AccountSession account() => const AccountSession(
    token: 'synthetic-token',
    expiresAtIso: '2099-01-01T00:00:00Z',
    deploymentId: 'public-test',
    ownerId: 'account-a',
    issuerOrigin: 'https://sync.test');
List<SubtitleSegment> segments(int count) => List.generate(
    count,
    (i) => SubtitleSegment(
        id: 's$i',
        revision: 1,
        sourceText: '原文$i',
        translatedText: 'Translation $i',
        sourceLanguage: 'zh',
        targetLanguage: 'en',
        stage: 'translation'));
final boundSession = RealtimeSession(
    sessionId: 'session-s',
    realtimeToken: 'synthetic-session',
    endpoint: Uri.parse('wss://sync.test/realtime'),
    expiresAt: DateTime.utc(2099),
    maxDurationSeconds: 60,
    syncBinding: const ResultSyncBinding(
        deploymentId: 'public-test',
        ownerId: 'account-a',
        modelPolicyRevision: 'policy-v1'));

class _SessionApi extends RealtimeApiClient {
  _SessionApi(http.Client client, AccountSessionStore accounts)
      : super(
            baseUrl: Uri.parse('https://sync.test'),
            publicDeploymentId: 'public-test',
            accountSessionStore: accounts,
            client: client);
  @override
  Future<RealtimeSession> createSession() async => boundSession;
}

class _Gateway extends RealtimeGatewayClient {
  @override
  Future<void> connect(RealtimeSession session) async {}
  @override
  Future<bool> endAndWait(String sessionId,{Duration timeout=const Duration(seconds:12)}) async=>false;
}

class _Harness {
  _Harness({Future<void> Function()? beforeReplace}) {
    store = LocalSessionStore(
        file: File('${directory.path}/old.json'),
        checkpointBeforeReplace: beforeReplace);
    api = _SessionApi(MockClient(handle), accounts);
    repo = RealtimeRepository(
        apiClient: api, gatewayClient: _Gateway(), resultSyncStore: store);
  }
  final directory = Directory.systemTemp.createTempSync('sync-sender-');
  final accounts = MemoryAccountSessionStore(account());
  late LocalSessionStore store;
  late RealtimeRepository repo;
  late _SessionApi api;
  final requests = <http.Request>[], syncBodies = <Map<String, Object?>>[];
  int revision = 0;
  bool failRevoke=false;
  bool allowed = false, failNext = false;
  Completer<http.Response>? delay;
  final requested = Completer<void>();
  Future<http.Response> handle(http.Request request) async {
    requests.add(request);
    if(request.url.path.endsWith('/recovery'))return json({},503);
    if (request.url.path == '/auth/deployment') {
      expect(request.headers.containsKey('authorization'), isFalse);
      return json({'deploymentId': 'public-test'});
    }
    expect(request.headers['authorization'], 'Bearer synthetic-token');
    final identity = {
      'deploymentId': 'public-test',
      'ownerId': 'account-a',
      'modelPolicyRevision': 'policy-v1'
    };
    if (request.url.path.endsWith('/result-sync-consent')) {
      if (request.method == 'GET') {
        return json({...identity, 'consentRevision': revision});
      }
      final body = jsonDecode(request.body) as Map;
      if(body['allowed']==false && failRevoke) return json({},503);
      if (body['expectedRevision'] != revision) return json({}, 409);
      revision++;
      allowed = body['allowed'] == true;
      return json({
        ...identity,
        'consentRevision': revision,
        'scopeId': 'scope-v2',
        'consentVersion': 'result-text-sync-v2',
        'expiresAt': '2099-01-01T00:00:00Z',
        if (!allowed) 'revokedAt': '2026-09-08T00:00:00Z'
      });
    }
    expect(request.url.path.endsWith('/segments'), isTrue);
    final body = jsonDecode(request.body) as Map<String, Object?>;
    syncBodies.add(body);
    if (!requested.isCompleted) requested.complete();
    if (delay != null) return delay!.future;
    if (failNext) {
      failNext = false;
      return json({}, 503);
    }
    return ack(body);
  }

  http.Response ack(Map<String, Object?> body) {
    final sync = body['sync'] as Map;
    return json({
      'operation': 'sync',
      'sessionId': 'session-s',
      'ownerId': 'account-a',
      'deploymentId': sync['deploymentId'],
      'scopeId': sync['scopeId'],
      'modelPolicyRevision': sync['modelPolicyRevision'],
      'opId': sync['opId'],
      'acceptedRevisions': sync['revisions']
    });
  }

  http.Response json(Object value, [int status = 200]) =>
      http.Response(jsonEncode(value), status,
          headers: {'content-type': 'application/json; charset=utf-8'});
  Future<int> send() => repo.synchronizeResults(segments(1),
      mode: 'conversation', activeSeconds: 1);
  Future<List<LocalSessionCheckpoint>> records() =>
      store.loadCheckpoints(deploymentId: 'public-test', ownerId: 'account-a');
  void close() {
    repo.dispose();
    directory.deleteSync(recursive: true);
  }
}
