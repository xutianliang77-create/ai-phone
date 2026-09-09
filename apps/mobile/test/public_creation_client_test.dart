import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/api/public_creation_request_store.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';

const origin = 'https://public.synthetic.invalid';
AccountSession account([String owner = 'owner']) => AccountSession(token: 'SYNTHETIC_LOGIN_$owner', expiresAtIso: '2099-01-01T00:00:00Z', deploymentId: 'public', ownerId: owner, issuerOrigin: origin);
Map<String, Object?> offer(String owner, bool voice) => {
  'contractVersion': 1, 'deploymentId': 'public', 'ownerId': owner, 'configurationRevision': 1,
  'modelPolicyRevision': 'models-v1:${'a' * 64}', 'captureSampleRate': 16000, 'voiceOutput': voice,
  'endpoint': 'wss://gateway.synthetic.invalid/realtime', 'status': 'configured_not_verified', if (voice) 'voicePresetId': 'coral',
  'executionPlan': {'asr': {'execution': 'public', 'scopeKey': 'asr', 'reason': 'online_selected'},
    'translation': {'execution': 'public', 'scopeKey': 'mt', 'reason': 'online_selected'},
    'tts': voice ? {'execution': 'public', 'scopeKey': 'tts', 'reason': 'online_selected'} : {'execution': 'disabled'}}};
Map<String, Object?> response(http.Request request, String owner) {
  final body = jsonDecode(request.body) as Map<String, dynamic>;
  final p = {...body['processing'] as Map<String, dynamic>}..remove('syncRequested');
  p.addAll({'syncPermission': {'allowed': false}, 'publicGrantRef': 'grant'});
  final expiry = DateTime.now().toUtc().add(const Duration(minutes: 5)).millisecondsSinceEpoch ~/ 1000;
  final id = 'public-${request.headers['idempotency-key']}';
  final claims = {'sessionId': id, 'userId': owner, 'mode': body['mode'], 'sourceLanguage': body['sourceLanguage'], 'targetLanguage': body['targetLanguage'],
    'voiceOutput': body['voiceOutput'], if (body['voice'] != null) 'voice': body['voice'], 'processing': p, 'maxDurationSeconds': 60,
    'issuedAt': expiry - 300, 'expiresAt': expiry, 'publicRuntime': {'deploymentId': 'public', 'leaseId': 'lease', 'captureId': 'capture',
      'languagePolicyKey': 'language', 'sampleRate': 16000, 'configurationRevision': 1, 'configurationHash': 'a' * 64}};
  return {'sessionId': id, 'realtimeToken': '${base64Url.encode(utf8.encode(jsonEncode(claims))).replaceAll('=', '')}.c3ludGhldGlj',
    'endpoint': 'wss://gateway.synthetic.invalid/realtime', 'expiresAt': DateTime.fromMillisecondsSinceEpoch(expiry * 1000, isUtc: true).toIso8601String(),
    'maxDurationSeconds': 60, 'ownerId': owner, 'deploymentId': 'public', 'captureSampleRate': 16000, 'processing': p};
}
class Harness {
  final directory = Directory.systemTemp.createTempSync('wujie-public-create-');
  final accounts = MemoryAccountSessionStore(account());
  final requests = <http.Request>[];
  final clients = <RealtimeApiClient>[];
  Future<http.Response> Function(http.Request)? post;
  int contexts = 0;
  late final store = PublicCreationRequestStore(directory: directory);
  RealtimeApiClient create({String source = 'zh', String voice = 'off', Duration timeout = const Duration(seconds: 1)}) {
    final client = RealtimeApiClient(baseUrl: Uri.parse(origin), publicDeploymentId: 'public', sourceLanguage: source, targetLanguage: 'en',
      voiceOutputMode: voice, accountSessionStore: accounts, publicCreationRequestStore: store, requestTimeout: timeout,
      client: MockClient((request) async {
        requests.add(request);expect(request.followRedirects, isFalse);
        if (request.url.path == '/auth/deployment') { expect(request.headers['authorization'], isNull); return http.Response('{"deploymentId":"public"}', 200); }
        expect(request.headers['authorization'], 'Bearer ${accounts.session!.token}');
        if (request.method == 'GET') { contexts++;return http.Response(jsonEncode(offer(accounts.session!.ownerId!, request.url.queryParameters['voiceOutput'] == 'true')), 200); }
        final record = directory.listSync().whereType<File>().single.readAsStringSync();
        expect(record, contains(request.headers['idempotency-key']!));expect(record, isNot(contains(accounts.session!.token)));
        return post?.call(request) ?? http.Response(jsonEncode(response(request, accounts.session!.ownerId!)), 200);
      }));clients.add(client);return client;
  }
  void close() { for (final c in clients) { c.close(); } directory.deleteSync(recursive: true); }
}
class Gateway extends RealtimeGatewayClient {
  int connects = 0;
  @override Future<void> connect(RealtimeSession session) async { connects++; }
  @override Future<void> close() async {}
  @override void dispose() {}
}
void main() {
  test('persists request before POST, deduplicates concurrent create and consumes only after connection confirmation', () async {
    final h = Harness();addTearDown(h.close);final api = h.create();
    final values = await Future.wait([api.createSession(), api.createSession()]);
    expect(values[0].sessionId, values[1].sessionId);expect(h.requests.where((r) => r.method == 'POST'), hasLength(1));
    expect(values[0].syncBinding!.captureSampleRate, 16000);
    expect(h.directory.listSync().whereType<File>().single.readAsStringSync(), isNot(contains(values[0].realtimeToken)));
    await api.confirmPublicCreationConnected(values[0]);final next = await api.createSession();expect(next.sessionId, isNot(values[0].sessionId));
  });
  test('timeout and client recreation reuse the same durable key and exact payload without automatic retry', () async {
    final h = Harness();addTearDown(h.close);final delayed = Completer<http.Response>();h.post = (_) => delayed.future;
    final api = h.create(timeout: const Duration(milliseconds: 40));await expectLater(api.createSession(), throwsA(isA<TimeoutException>()));
    final first = h.requests.last;expect(h.requests.where((r) => r.method == 'POST'), hasLength(1));api.close();h.post = null;
    final restarted = h.create();await restarted.createSession();final second = h.requests.last;
    expect(second.headers['idempotency-key'], first.headers['idempotency-key']);expect(second.body, first.body);expect(h.contexts, 1);
    delayed.complete(http.Response(jsonEncode(response(first, 'owner')), 200));await Future<void>.delayed(Duration.zero);
  });
  test('does not replace an unresolved key when language settings change', () async {
    final h = Harness();addTearDown(h.close);h.post = (_) async => http.Response('{}', 503);
    await expectLater(h.create().createSession(), throwsA(isA<RealtimeApiException>()));
    final count = h.requests.where((r) => r.method == 'POST').length;
    await expectLater(h.create(source: 'fr').createSession(), throwsA(isA<RealtimeApiException>()));expect(h.requests.where((r) => r.method == 'POST').length, count);
  });
  test('account switch invalidates a delayed result', () async {
    final h = Harness();addTearDown(h.close);final delayed = Completer<http.Response>();h.post = (_) => delayed.future;
    final result = h.create().createSession(), check = expectLater(result, throwsA(isA<RealtimeApiException>()));
    while (!h.requests.any((r) => r.method == 'POST')) { await Future<void>.delayed(Duration.zero); }
    final posted = h.requests.last;await h.accounts.save(account('other'));delayed.complete(http.Response(jsonEncode(response(posted, 'owner')), 200));await check;
  });
  test('repository stop before HTTP completion never connects a late session or calls legacy end', () async {
    final h = Harness();addTearDown(h.close);final delayed = Completer<http.Response>();h.post = (_) => delayed.future;
    final gateway = Gateway(), repo = RealtimeRepository(apiClient: h.create(), gatewayClient: gateway);addTearDown(repo.dispose);
    final start = repo.startSession(), check = expectLater(start, throwsA(isA<RealtimeApiException>()));
    while (!h.requests.any((r) => r.method == 'POST')) { await Future<void>.delayed(Duration.zero); }
    final posted = h.requests.last;repo.cancelPendingStart();await check;
    delayed.complete(http.Response(jsonEncode(response(posted, 'owner')), 200));await Future<void>.delayed(Duration.zero);expect(gateway.connects, 0);
    expect(h.requests.any((r) => r.url.path.endsWith('/end')), isFalse);
  });
  for (final field in ['ownerId', 'captureSampleRate', 'endpoint', 'realtimeToken']) {
    test('rejects wrong response $field before connection confirmation', () async {
      final h = Harness();addTearDown(h.close);h.post = (request) async { final value = response(request, 'owner');value[field] = field == 'captureSampleRate' ? 24000 : 'wrong';return http.Response(jsonEncode(value), 200); };
      await expectLater(h.create().createSession(), throwsA(isA<FormatException>()));
      final file = jsonDecode(h.directory.listSync().whereType<File>().single.readAsStringSync());expect(file['state'], 'pending');
    });
  }
  test('public natural speech binds server voice without changing the private preset', () async {
    final h = Harness();addTearDown(h.close);await h.create(voice: 'natural').createSession();
    expect((jsonDecode(h.requests.last.body) as Map)['voice'], {'mode': 'preset', 'presetId': 'coral'});
    expect(h.requests.any((r) => r.url.path.contains('voice-profiles')), isFalse);
  });
  test('invalid store content is not overwritten and credentials cannot be stored', () async {
    final h = Harness();addTearDown(h.close);const scope = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await expectLater(h.store.acquire(scope, 'settings', {'apiKey': 'SYNTHETIC'}, 'wss://test.invalid'), throwsA(isA<FormatException>()));
    final file = File('${h.directory.path}/public_creation_v1_$scope.json');file.writeAsStringSync('broken');
    await expectLater(h.store.pending(scope), throwsA(isA<FormatException>()));expect(file.readAsStringSync(), 'broken');
  });
}
