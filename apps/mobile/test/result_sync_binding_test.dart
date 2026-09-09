import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/account/data/account_auth_headers.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/realtime/data/finalization/result_sync_receipt.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory directory;
  late LocalSessionStore store;
  setUp(() {
    directory = Directory.systemTemp.createTempSync('result-sync-binding-');
    store = LocalSessionStore(file: File('${directory.path}/history.json'));
  });
  tearDown(() => directory.deleteSync(recursive: true));
  AccountRequestScope scope(
          {String owner = 'account-a',
          String deployment = 'public-a',
          String host = 'https://example.test'}) =>
      AccountRequestScope(
          deploymentId: deployment,
          ownerId: owner,
          apiBaseUrl: Uri.parse(host));
  AccountSession token(
          {String owner = 'account-a',
          String deployment = 'public-a',
          String issuer = 'https://example.test',
          String expiry = '2099-01-01T00:00:00Z'}) =>
      AccountSession(
          token: 'synthetic-only',
          expiresAtIso: expiry,
          deploymentId: deployment,
          ownerId: owner,
          issuerOrigin: issuer);
  test(
      'public authorization rejects legacy, expired, other-owner/deployment/origin tokens',
      () async {
    for (final session in [
      const AccountSession(
          token: 'private-legacy', expiresAtIso: '2099-01-01T00:00:00Z'),
      token(owner: 'b'),
      token(deployment: 'private'),
      token(issuer: 'https://other.test'),
      token(expiry: '2000-01-01T00:00:00Z'),
      token(expiry: 'invalid')
    ]) {
      await expectLater(
          accountAuthorizationHeaders(MemoryAccountSessionStore(session),
              scope: scope()),
          throwsA(isA<AccountAuthRequiredException>()));
    }
    expect(
        (await accountAuthorizationHeaders(MemoryAccountSessionStore(token()),
                scope: scope()))['authorization'],
        'Bearer synthetic-only');
    final headers = await accountAuthorizationHeaders(MemoryAccountSessionStore(token()),
      scope: scope(), baseHeaders: {'Authorization': 'synthetic-old-private', 'content-type': 'application/json'});
    expect(headers.containsKey('Authorization'), isFalse);
    expect(headers.values, isNot(contains('synthetic-old-private')));
  });
  test('scoped files never migrate or clear the original account file',
      () async {
    final previous = PathProviderPlatform.instance;
    PathProviderPlatform.instance = _Paths(directory.path);
    addTearDown(() => PathProviderPlatform.instance = previous);
    const original = FileAccountSessionStore();
    await original.save(const AccountSession(
        token: 'synthetic-private', expiresAtIso: '2099-01-01T00:00:00Z'));
    final bytes =
        await File('${directory.path}/account_session.json').readAsBytes();
    final a = FileAccountSessionStore(scope: scope()),
        b = FileAccountSessionStore(scope: scope(owner: 'b'));
    expect(await a.load(), isNull);
    await a.save(token());
    expect((await a.load())!.ownerId, 'account-a');
    expect(await b.load(), isNull);
    await expectLater(b.save(token()), throwsStateError);
    await a.clear();
    expect(await File('${directory.path}/account_session.json').readAsBytes(),
        bytes);
  });
  test('scope prohibits cleartext remote origins and credential-bearing URLs',
      () {
    expect(() => scope(host: 'http://example.test'), throwsArgumentError);
    expect(() => scope(host: 'https://user:pass@example.test'),
        throwsArgumentError);
    expect(
        () => scope(host: 'https://example.test?token=x'), throwsArgumentError);
    expect(scope(host: 'http://127.0.0.1:1234').issuerOrigin,
        'http://127.0.0.1:1234');
  });
  test(
      'Dart and server use identical canonical text hash without sending metadata',
      () {
    final fixture = jsonDecode(
        File('../../packages/contracts/fixtures/result-sync-v1.json')
            .readAsStringSync()) as Map;
    final request = resultSyncRequest(checkpoint(fixture),
        scopeId: 'scope-v1', modelPolicyRevision: 'policy-v1', opId: 'op1');
    expect(
        ((request['sync'] as Map)['revisions'] as List).single['contentHash'],
        fixture['sha256']);
    expect((request['segments'] as List).single, fixture['segment']);
  });
  test(
      'only exact bound ACK clears pending; old ACK cannot clear a newer snapshot',
      () async {
    final fixture = jsonDecode(
        File('../../packages/contracts/fixtures/result-sync-v1.json')
            .readAsStringSync()) as Map;
    final record = checkpoint(fixture);
    await store.putCheckpoint(record);
    final request = resultSyncRequest(record,
        scopeId: 'scope-v1', modelPolicyRevision: 'policy-v1', opId: 'op1');
    final ack = <String, Object?>{
      'operation': 'sync',
      'deploymentId': 'public-a',
      'ownerId': 'account-a',
      'sessionId': 'cloud-session',
      'scopeId': 'scope-v1',
      'modelPolicyRevision': 'policy-v1',
      'opId': 'op1',
      'acceptedRevisions': (request['sync'] as Map)['revisions']
    };
    Future<bool> apply(Object? value) =>
        applyResultSyncAck(store, record, value,
            scopeId: 'scope-v1', modelPolicyRevision: 'policy-v1', opId: 'op1');
    for (final key in [
      'operation',
      'deploymentId',
      'ownerId',
      'sessionId',
      'scopeId',
      'modelPolicyRevision',
      'opId'
    ]) {
      expect(await apply({...ack, key: 'wrong'}), isFalse);
    }
    expect(await apply({...ack, 'acceptedRevisions': []}), isFalse);
    expect(
        await apply({
          ...ack,
          'acceptedRevisions': [
            ...(ack['acceptedRevisions'] as List),
            ...(ack['acceptedRevisions'] as List)
          ]
        }),
        isFalse);
    expect(await apply(ack), isTrue);
    expect(await apply(ack), isFalse);
    await store.putCheckpoint(checkpoint(fixture, revision: 8));
    expect(await apply(ack), isFalse);
    expect(
        (await store.loadCheckpoints(
                deploymentId: 'public-a', ownerId: 'account-a'))
            .single
            .pending,
        hasLength(1));
  });
  test('device-local checkpoint can never become a cloud sync request', () {
    final fixture = jsonDecode(
        File('../../packages/contracts/fixtures/result-sync-v1.json')
            .readAsStringSync()) as Map;
    final local = LocalSessionCheckpoint.fromJson({
      ...checkpoint(fixture).toJson(),
      'deploymentId': deviceLocalDeployment
    });
    expect(
        () => resultSyncRequest(local,
            scopeId: 'scope', modelPolicyRevision: 'policy', opId: 'op1'),
        throwsStateError);
  });
}

LocalSessionCheckpoint checkpoint(Map fixture, {int revision = 7}) =>
    LocalSessionCheckpoint(
        deploymentId: 'public-a',
        ownerId: 'account-a',
        revision: revision,
        snapshot: SessionDetail(
            sessionId: 'cloud-session',
            mode: 'conversation',
            status: 'active',
            consumedSeconds: 5,
            createdAt: DateTime.utc(2026),
            segmentCount: 1,
            segments: [
              SessionSegment.fromJson(
                  Map<String, Object?>.from(fixture['segment'] as Map))
            ]),
        pending: [
          CheckpointOperation(
              opId: 'op1',
              revision: revision,
              kind: CheckpointOperationKind.sync)
        ]);

class _Paths extends PathProviderPlatform {
  _Paths(this.path);
  final String path;
  @override
  Future<String?> getApplicationSupportPath() async => path;
}
