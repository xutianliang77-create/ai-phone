import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/public_creation_request_store.dart';
import 'public_creation_client_test.dart' as fixture;

Map<String, Object?> receipt(http.Request r, String state) {
  final b = jsonDecode(r.body) as Map<String, dynamic>;
  final key = r.headers['idempotency-key'];
  return {'contractVersion': 1, 'sessionId': 'public-${publicCreationHash({
    'deploymentId': 'public', 'ownerId': 'owner', 'idempotencyKey': key})}',
    'ownerId': 'owner', 'deploymentId': 'public', 'nonce': b['nonce'],
    'requestHash': publicCreationHash(b['request']), 'state': state,
    'safeToReplace': ['cancelled', 'expired'].contains(state),
    'canRetire': ['not_found', 'prepared', 'issued', 'expired_pending'].contains(state)};
}
Future<(fixture.Harness, RealtimeApiClient)> pending() async {
  final h = fixture.Harness();
  h.post = (_) async => http.Response('{}', 503);
  final api = h.create();
  await expectLater(api.createSession(), throwsA(isA<RealtimeApiException>()));
  return (h, api);
}
Map<String, dynamic> disk(fixture.Harness h) => jsonDecode(h.directory.listSync()
  .whereType<File>().singleWhere((f) => f.path.endsWith('.json')).readAsStringSync()) as Map<String, dynamic>;

void main() {
  for (final state in ['not_found', 'prepared', 'issued', 'expired_pending', 'reconciliation_required']) {
    test('$state query preserves the pending key and sends only original body, nonce and key', () async {
      final (h, api) = await pending(); addTearDown(h.close);
      final before = disk(h);
      h.post = (r) async { expect(r.url.path, '/realtime/creation-requests/query');
        final body = jsonDecode(r.body); expect(body.keys.toSet(), {'request', 'nonce'});
        expect(body['request'], before['body']); expect(r.headers['idempotency-key'], before['key']);
        return http.Response(jsonEncode(receipt(r, state)), 200); };
      final result = await api.resolvePendingPublicCreation();
      expect(result!.state, state); expect(result.terminal, false); expect(disk(h), before);
    });
  }
  test('exact terminal receipt is persisted and next explicit start uses a new key', () async {
    final (h, api) = await pending(); addTearDown(h.close);final old = disk(h)['key'];
    h.post = (r) async => http.Response(jsonEncode(receipt(r,
      r.url.path.endsWith('/query') ? 'issued' : 'cancelled')), 200);
    final q = await api.resolvePendingPublicCreation();
    final result = await api.resolvePendingPublicCreation(action: 'cancel', expected: q);
    expect(result!.terminal, true);expect(disk(h)['state'], 'retired');
    expect(disk(h)['resolution'], result.receipt);
    expect(h.requests.where((r) => r.url.path == '/realtime/sessions'), hasLength(1));
    h.post = null;await h.create(source: 'fr').createSession();expect(disk(h)['key'], isNot(old));
    expect(disk(h)['body']['sourceLanguage'], 'fr');
  });
  test('query recovers a lost cancel response and explicit expiry uses its own endpoint', () async {
    final (h, api) = await pending();addTearDown(h.close);
    h.post = (r) async => http.Response(jsonEncode(receipt(r, 'expired_pending')), 200);
    final q = await api.resolvePendingPublicCreation();
    h.post = (r) async {expect(r.url.path, '/realtime/creation-requests/expire');return http.Response('{}', 503);};
    await expectLater(api.resolvePendingPublicCreation(action: 'expire', expected: q), throwsA(isA<RealtimeApiException>()));expect(disk(h)['state'], 'pending');
    h.post = (r) async => http.Response(jsonEncode(receipt(r, 'expired')), 200);
    expect((await api.resolvePendingPublicCreation())!.terminal, true);expect(disk(h)['state'], 'retired');
  });
  for (final bad in ['ownerId','deploymentId','sessionId','nonce','requestHash','state','safeToReplace','canRetire','extra']) {
    test('rejects $bad mismatch without clearing old request', () async {
      final (h, api) = await pending();addTearDown(h.close);final before=disk(h);
      h.post = (r) async {final value=receipt(r,'cancelled');value[bad] = 'bad';return http.Response(jsonEncode(value),200);};
      await expectLater(api.resolvePendingPublicCreation(), throwsA(isA<FormatException>()));expect(disk(h), before);
    });
  }
  test('cannot cancel before querying, expire an unexpired request, or discard a running request', () async {
    final (h, api)=await pending();addTearDown(h.close);final count=h.requests.length;
    await expectLater(api.resolvePendingPublicCreation(action:'cancel'),throwsA(isA<RealtimeApiException>()));expect(h.requests.length,count);
    h.post=(r) async=>http.Response(jsonEncode(receipt(r,'issued')),200);final q=await api.resolvePendingPublicCreation();
    await expectLater(api.resolvePendingPublicCreation(action:'expire',expected:q),throwsA(isA<RealtimeApiException>()));
    h.post=(r) async=>http.Response(jsonEncode(receipt(r,'reconciliation_required')),200);final running=await api.resolvePendingPublicCreation();
    await expectLater(api.resolvePendingPublicCreation(action:'cancel',expected:running),throwsA(isA<RealtimeApiException>()));expect(disk(h)['state'],'pending');
  });
  test('account switch during query cannot accept old receipt or cancel another account request', () async {
    final (h, api)=await pending();addTearDown(h.close);final delayed=Completer<http.Response>();http.Request? sent;
    h.post=(r){sent=r;return delayed.future;};final future=api.resolvePendingPublicCreation();
    while(sent==null){await Future<void>.delayed(Duration.zero);}
    await h.accounts.save(fixture.account('other'));
    delayed.complete(http.Response(jsonEncode(receipt(sent!,'cancelled')),200));await expectLater(future,throwsA(anything));expect(disk(h)['state'],'pending');
  });
  test('stop waiting rejects late terminal response and concurrent starts, retaining pending state', () async {
    final (h,api)=await pending();addTearDown(h.close);final delayed=Completer<http.Response>();http.Request? sent;
    h.post=(r){sent=r;return delayed.future;};final query=api.resolvePendingPublicCreation();
    final failed=expectLater(query,throwsA(isA<RealtimeApiException>()));
    while(sent==null){await Future<void>.delayed(Duration.zero);}
    await expectLater(api.createSession(),throwsA(isA<RealtimeApiException>()));
    await expectLater(api.resolvePendingPublicCreation(),throwsA(isA<RealtimeApiException>()));
    api.cancelPublicCreationWait();await failed;delayed.complete(http.Response(jsonEncode(receipt(sent!,'cancelled')),200));
    await Future<void>.delayed(Duration.zero);expect(disk(h)['state'],'pending');
  });
  test('disk failure cannot advertise completion or unlock the pending key', () async {
    final (h,api)=await pending();addTearDown(h.close);final before=disk(h);
    final file=h.directory.listSync().whereType<File>().single;
    Directory('${file.path}.tmp').createSync();
    h.post=(r)async=>http.Response(jsonEncode(receipt(r,'cancelled')),200);
    await expectLater(api.resolvePendingPublicCreation(),throwsA(isA<FileSystemException>()));expect(disk(h),before);
  });
  test('old query cannot retire a new key, and late started cannot revive a retired key', () async {
    final (h,api)=await pending();addTearDown(h.close);
    h.post=(r)async=>http.Response(jsonEncode(receipt(r,'issued')),200);final q=await api.resolvePendingPublicCreation();
    h.post=(r)async=>http.Response(jsonEncode(receipt(r,'cancelled')),200);await api.resolvePendingPublicCreation(action:'cancel',expected:q);
    await expectLater(h.store.connected(q!.scope,q.requestKey,'old'),throwsA(isA<StateError>()));
    h.post=(_)async=>http.Response('{}',503);await expectLater(api.createSession(),throwsA(isA<RealtimeApiException>()));
    await expectLater(api.resolvePendingPublicCreation(action:'cancel',expected:q),throwsA(isA<RealtimeApiException>()));
  });
  test('no pending record causes no network request or new file', () async {
    final h=fixture.Harness();addTearDown(h.close);
    expect(await h.create().resolvePendingPublicCreation(),isNull);expect(h.requests,isEmpty);expect(h.directory.listSync(),isEmpty);
  });
  test('explicit expiry persists its terminal receipt without issuing a new create', () async {
    final (h,api)=await pending();addTearDown(h.close);
    h.post=(r)async=>http.Response(jsonEncode(receipt(r,'expired_pending')),200);
    final q=await api.resolvePendingPublicCreation();
    h.post=(r)async {expect(r.url.path,'/realtime/creation-requests/expire');return http.Response(jsonEncode(receipt(r,'expired')),200);};
    expect((await api.resolvePendingPublicCreation(action:'expire',expected:q))!.terminal,true);
    expect(disk(h)['resolution']['state'],'expired');expect(h.requests.where((r)=>r.url.path=='/realtime/sessions'),hasLength(1));
  });
  test('nonterminal mutation response and oversized response retain pending key', () async {
    final (h,api)=await pending();addTearDown(h.close);
    h.post=(r)async=>http.Response(jsonEncode(receipt(r,'issued')),200);final q=await api.resolvePendingPublicCreation();
    await expectLater(api.resolvePendingPublicCreation(action:'cancel',expected:q),throwsA(isA<RealtimeApiException>()));
    h.post=(_)async=>http.Response('x'*65537,200);
    await expectLater(api.resolvePendingPublicCreation(),throwsA(anything));expect(disk(h)['state'],'pending');
  });
}
