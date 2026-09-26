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
import 'package:translation_mobile/src/features/realtime/data/api/public_creation_contract.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/platform/audio/device_speaker_diarizer.dart';

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
    if(body.containsKey('termbaseId')) 'termbaseId':body['termbaseId'],
    if(body.containsKey('domainLexiconPacks')) 'domainLexiconPacks':body['domainLexiconPacks'],
    if(body.containsKey('termbaseId')||body.containsKey('domainLexiconPacks')) 'publicTerminologyHash':'b'*64,
    if ((body['speakerAttribution'] as Map?)?['deviceProfile'] != null) 'speakerAttribution': body['speakerAttribution'],
    'voiceOutput': body['voiceOutput'], if (body['voice'] != null) 'voice': body['voice'], 'processing': p,
    'issuedAt': expiry - 300, 'expiresAt': expiry, 'publicRuntime': {'deploymentId': 'public', 'leaseId': 'lease', 'captureId': 'capture',
      'languagePolicyKey': 'language', 'sampleRate': 16000, 'configurationRevision': 1, 'configurationHash': 'a' * 64}};
  return {'sessionId': id, 'realtimeToken': '${base64Url.encode(utf8.encode(jsonEncode(claims))).replaceAll('=', '')}.c3ludGhldGlj',
    if (claims['speakerAttribution'] != null) 'speakerAttribution': claims['speakerAttribution'],
    'endpoint': 'wss://gateway.synthetic.invalid/realtime', 'expiresAt': DateTime.fromMillisecondsSinceEpoch(expiry * 1000, isUtc: true).toIso8601String(),
    'ownerId': owner, 'deploymentId': 'public', 'captureSampleRate': 16000, 'processing': p};
}
Map<String, Object?> resolutionResponse(http.Request request, String state) {
  final body = jsonDecode(request.body) as Map<String, dynamic>;
  final key = request.headers['idempotency-key'];
  return {
    'contractVersion': 1,
    'sessionId': 'public-${publicCreationHash({
      'deploymentId': 'public', 'ownerId': 'owner', 'idempotencyKey': key})}',
    'ownerId': 'owner', 'deploymentId': 'public', 'nonce': body['nonce'],
    'requestHash': publicCreationHash(body['request']), 'state': state,
    'safeToReplace': ['cancelled', 'expired'].contains(state),
    'canRetire': ['not_found', 'prepared', 'issued', 'expired_pending'].contains(state),
  };
}

class Harness {
  final directory = Directory.systemTemp.createTempSync('wujie-public-create-');
  final accounts = MemoryAccountSessionStore(account());
  final requests = <http.Request>[];
  final clients = <RealtimeApiClient>[];
  Future<http.Response> Function(http.Request)? post;
  http.Response? getResponse;
  Map<String, Object?>? context;
  int contexts = 0;
  late final store = PublicCreationRequestStore(directory: directory);
  RealtimeApiClient create({String source = 'zh', String voice = 'off', Duration timeout = const Duration(seconds: 1), Future<bool> Function()? prepareSpeaker}) {
    final client = RealtimeApiClient(baseUrl: Uri.parse(origin), publicDeploymentId: 'public', sourceLanguage: source, targetLanguage: 'en',
      prepareDeviceSpeaker: prepareSpeaker,
      voiceOutputMode: voice, accountSessionStore: accounts, publicCreationRequestStore: store, requestTimeout: timeout,
      client: MockClient((request) async {
        requests.add(request);expect(request.followRedirects, isFalse);
        if (request.url.path == '/auth/deployment') { expect(request.headers['authorization'], isNull); return http.Response('{"deploymentId":"public"}', 200); }
        expect(request.headers['authorization'], 'Bearer ${accounts.session!.token}');
        if (request.method == 'GET') { contexts++;return getResponse ?? http.Response(jsonEncode(context ?? offer(accounts.session!.ownerId!, request.url.queryParameters['voiceOutput'] == 'true')), 200); }
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
  const speakerOffer = {'available':true,'id':deviceSpeakerProfile,'revision':deviceSpeakerRevision,
    'maxSpeakers':4,'execution':'on_device','anonymousOnly':true,'requiresLocalReadiness':true};
  test('speaker preparation completes before creation and exact selection returns in signed response', () async {
    final h=Harness();addTearDown(h.close);h.context={...offer('owner',false),'onDeviceSpeaker':speakerOffer};
    final prepared=Completer<bool>(),client=h.create(prepareSpeaker:()=>prepared.future);
    final future=client.createSession();await Future<void>.delayed(const Duration(milliseconds:20));
    expect(h.requests.where((r)=>r.method=='POST'),isEmpty);prepared.complete(true);
    final session=await future;expect(session.deviceSpeakerProfile,deviceSpeakerProfile);
    final body=jsonDecode(h.requests.singleWhere((r)=>r.method=='POST').body);
    expect(body['speakerAttribution'],deviceSpeakerSelection);
  });
  test('missing local resource keeps cloud ASR/MT usable with speaker off', () async {
    final h=Harness();addTearDown(h.close);h.context={...offer('owner',false),'onDeviceSpeaker':speakerOffer};
    final session=await h.create(prepareSpeaker:() async=>false).createSession();
    expect(session.deviceSpeakerProfile,isNull);
    expect(jsonDecode(h.requests.singleWhere((r)=>r.method=='POST').body)['speakerAttribution'],{'mode':'off'});
  });
  test('server off gate never loads the speaker model', () async {
    final h=Harness();addTearDown(h.close);int preparations=0;
    await h.create(prepareSpeaker:() async {preparations++;return true;}).createSession();expect(preparations,0);
  });
  test('stripped speaker selection in response fails exact binding check', () async {
    final h=Harness();addTearDown(h.close);h.context={...offer('owner',false),'onDeviceSpeaker':speakerOffer};
    h.post=(r) async {final value=response(r,'owner')..remove('speakerAttribution');return http.Response(jsonEncode(value),200);};
    await expectLater(h.create(prepareSpeaker:() async=>true).createSession(),throwsA(isA<FormatException>()));
  });
  test('emits the shared public creation v1 request fixture', () {
    final fixture = jsonDecode(File(
            '../../packages/contracts/fixtures/public-creation-v1.json')
        .readAsStringSync()) as Map;
    final offer = (fixture['offer'] as Map).cast<String, Object?>();
    final request = publicCreationBody(
      offer,
      deploymentId: offer['deploymentId']! as String,
      ownerId: offer['ownerId']! as String,
      mode: 'conversation',
      source: 'fr',
      target: 'ja',
      autoReverse: false,
      automaticLanguagePair: null,
      voice: false,
    );
    expect(request, (fixture['request'] as Map).cast<String, Object?>());
  });
  test('preserves the inherited online auto-to-auto-reverse language contract',
      () {
    final fixture = jsonDecode(File(
            '../../packages/contracts/fixtures/public-creation-v1.json')
        .readAsStringSync()) as Map;
    final offer = {
      ...(fixture['offer'] as Map).cast<String, Object?>(),
      'status': 'qualified',
      'capability': {
        'status': 'qualified',
        'qualifiedLanguagePairs': const [
          {'source': 'zh', 'target': 'en'},
          {'source': 'en', 'target': 'zh'},
        ],
        'automaticLanguage': true,
        'automaticReverse': true,
      },
    };
    final request = publicCreationBody(offer,
        deploymentId: offer['deploymentId']! as String,
        ownerId: offer['ownerId']! as String,
        mode: 'conversation',
        source: 'auto',
        target: 'en',
        autoReverse: true,
        automaticLanguagePair: ('zh', 'en'),
        voice: false);
    expect(request['autoReverseTargetLanguage'], true);
    expect((request['processing'] as Map)['languagePolicy'], {
      'source': 'auto',
      'target': 'en',
      'autoReverse': true,
      'pair': ['zh', 'en'],
      'revision': 1,
    });
  });
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
    // A resumed durable request keeps its original POST payload and key, but
    // re-reads the current capability contract before it retries.
    expect(second.headers['idempotency-key'], first.headers['idempotency-key']);expect(second.body, first.body);expect(h.contexts, 2);
    delayed.complete(http.Response(jsonEncode(response(first, 'owner')), 200));await Future<void>.delayed(Duration.zero);
  });
  test('changed language retires only a server-confirmed unused key behind Start', () async {
    final h = Harness();addTearDown(h.close);h.post = (_) async => http.Response('{}', 503);
    await expectLater(h.create().createSession(), throwsA(isA<RealtimeApiException>()));
    final oldKey = h.requests.last.headers['idempotency-key'];
    h.post = (r) async => r.url.path == '/realtime/creation-requests/query'
        ? http.Response(jsonEncode(resolutionResponse(r, 'prepared')), 200)
        : r.url.path == '/realtime/creation-requests/cancel'
            ? http.Response(jsonEncode(resolutionResponse(r, 'cancelled')), 200)
            : http.Response(jsonEncode(response(r, 'owner')), 200);
    await h.create(source: 'fr').createSession();
    final posts = h.requests.where((r) => r.method == 'POST').toList();
    expect(posts.map((r) => r.url.path), [
      '/realtime/sessions', '/realtime/creation-requests/query',
      '/realtime/creation-requests/cancel', '/realtime/sessions'
    ]);
    expect(posts.last.headers['idempotency-key'], isNot(oldKey));
    expect(jsonDecode(posts.last.body)['sourceLanguage'], 'fr');
  });
  test('a used QA grant stops after one safe replacement without a retry loop', () async {
    final h = Harness();addTearDown(h.close);var creates = 0;
    h.post = (r) async {
      if (r.url.path == '/realtime/creation-requests/query') {
        return http.Response(jsonEncode(resolutionResponse(r, 'prepared')), 200);
      }
      if (r.url.path == '/realtime/creation-requests/cancel') {
        return http.Response(jsonEncode(resolutionResponse(r, 'cancelled')), 200);
      }
      return http.Response('{"error":{"code":"public_qa_one_shot_consumed"}}',
          creates++ == 0 ? 403 : 409);
    };
    await expectLater(h.create().createSession(), throwsA(isA<RealtimeApiException>()));
    expect(creates, 2);
    expect(h.requests.where((r) => r.url.path == '/realtime/creation-requests/cancel'), hasLength(1));
    final stored = jsonDecode(h.directory.listSync().whereType<File>().single.readAsStringSync()) as Map;
    expect(stored['state'], 'pending');
  });
  test('unavailable configuration reports no session created and never posts', () async {
    final h = Harness();addTearDown(h.close);
    h.getResponse = http.Response('{"error":{"code":"public_creation_not_ready"}}', 503);
    await expectLater(h.create().createSession(), throwsA(isA<RealtimeApiException>()
        .having((e) => e.message, 'message', contains('在线服务暂未开放'))
        .having((e) => e.statusCode, 'statusCode', 503)));
    expect(h.requests.where((r) => r.method == 'POST'), isEmpty);
    expect(h.directory.listSync(), isEmpty);
  });
  test('creation POST failure remains unresolved and is not retried automatically', () async {
    final h = Harness();addTearDown(h.close);
    h.post = (_) async => http.Response('{"error":{"code":"public_creation_not_ready"}}', 503);
    await expectLater(h.create().createSession(), throwsA(isA<RealtimeApiException>()
        .having((e) => e.message, 'message', contains('请稍后再点开始'))));
    expect(h.requests.where((r) => r.method == 'POST'), hasLength(1));
    expect(h.directory.listSync().whereType<File>(), hasLength(1));
  });
  for (final state in ['not_found', 'prepared', 'issued', 'expired_pending']) {
    test('one Start safely retires a $state 403 replay before a fresh session', () async {
      final h = Harness();addTearDown(h.close);var creates = 0;
      h.post = (r) async {
        if (r.url.path == '/realtime/creation-requests/query') {
          return http.Response(jsonEncode(resolutionResponse(r, state)), 200);
        }
        if (r.url.path == '/realtime/creation-requests/cancel' ||
            r.url.path == '/realtime/creation-requests/expire') {
          expect(r.url.path, state == 'expired_pending'
              ? '/realtime/creation-requests/expire'
              : '/realtime/creation-requests/cancel');
          return http.Response(jsonEncode(resolutionResponse(r,
              state == 'expired_pending' ? 'expired' : 'cancelled')), 200);
        }
        if (creates++ == 0) {
          return http.Response('{"error":{"code":"public_inference_admission_expired"}}', 403);
        }
        return http.Response(jsonEncode(response(r, 'owner')), 200);
      };
      final session = await h.create().createSession();
      expect(session.sessionId, isNotEmpty);
      final posts = h.requests.where((r) => r.method == 'POST').toList();
      expect(posts.map((r) => r.url.path), [
        '/realtime/sessions', '/realtime/creation-requests/query',
        state == 'expired_pending' ? '/realtime/creation-requests/expire'
            : '/realtime/creation-requests/cancel', '/realtime/sessions'
      ]);
      expect(posts.first.headers['idempotency-key'],
          isNot(posts.last.headers['idempotency-key']));
      expect(creates, 2);
    });
  }
  test('uncertain prior activity blocks a second charged session behind Start', () async {
    final h = Harness();addTearDown(h.close);
    h.post = (r) async => r.url.path == '/realtime/sessions'
        ? http.Response('{"error":{"code":"public_admission_binding_mismatch"}}', 403)
        : http.Response(jsonEncode(resolutionResponse(r, 'reconciliation_required')), 200);
    await expectLater(h.create().createSession(), throwsA(isA<RealtimeApiException>()
        .having((e) => e.message, 'message', contains('状态尚未确认'))));
    expect(h.requests.where((r) => r.url.path == '/realtime/sessions'), hasLength(1));
    expect(h.requests.where((r) => r.url.path.endsWith('/cancel')), isEmpty);
    final stored = jsonDecode(h.directory.listSync().whereType<File>().single.readAsStringSync()) as Map;
    expect(stored['state'], 'pending');
  });
  test('invalid retirement proof cannot replace the original key', () async {
    final h = Harness();addTearDown(h.close);
    h.post = (r) async => r.url.path == '/realtime/sessions'
        ? http.Response('{"error":{"code":"public_inference_admission_expired"}}', 403)
        : http.Response('{}', 200);
    await expectLater(h.create().createSession(), throwsA(isA<FormatException>()));
    expect(h.requests.where((r) => r.url.path == '/realtime/sessions'), hasLength(1));
    final stored = jsonDecode(h.directory.listSync().whereType<File>().single.readAsStringSync()) as Map;
    expect(stored['state'], 'pending');
  });
  test('qualified-pair preflight rejects an unqualified language before persistence or POST', () async {
    final h = Harness();addTearDown(h.close);
    h.context = {...offer('owner', false), 'capability': {'status': 'qualified', 'qualifiedLanguagePairs': [{'source': 'en', 'target': 'zh'}], 'automaticLanguage': false, 'automaticReverse': false}};
    await expectLater(h.create().createSession(), throwsA(isA<RealtimeApiException>()));
    expect(h.requests.where((r) => r.method == 'POST'), isEmpty);expect(h.directory.listSync(), isEmpty);
  });
  test('unqualified effective components reject before persistence or POST', () async {
    final h = Harness();addTearDown(h.close);
    h.context = {...offer('owner', false), 'status': 'not_qualified', 'capability': {'status': 'not_qualified', 'qualifiedLanguagePairs': [], 'automaticLanguage': false, 'automaticReverse': false}};
    await expectLater(h.create().createSession(), throwsA(isA<RealtimeApiException>()));
    expect(h.requests.where((r) => r.method == 'POST'), isEmpty);expect(h.directory.listSync(), isEmpty);
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
