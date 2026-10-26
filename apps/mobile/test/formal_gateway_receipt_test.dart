import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/finalization/realtime_finalization_outbox.dart';
import 'package:translation_mobile/src/features/realtime/data/finalization/realtime_finalization_task.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';

void main() {
  test(
      'legacy outbox remains readable; a later zero update preserves proof and segments',
      () async {
    final directory = await Directory.systemTemp.createTemp('formal-receipt-');
    addTearDown(() => directory.delete(recursive: true));
    final file = File('${directory.path}/outbox.json');
    await file.writeAsString(jsonEncode({
      'version': 1,
      'tasks': [task().toJson()]
    }));
    final outbox = FileRealtimeFinalizationOutbox(file: file);
    expect((await outbox.load()).single.gatewayReceipt, isNull);
    await outbox.upsert(task(proof: 'fixture-stop-proof', seconds: 12));
    await outbox.upsert(task(seconds: 0));
    final restored =
        (await FileRealtimeFinalizationOutbox(file: file).load()).single;
    expect(restored.gatewayReceipt, 'fixture-stop-proof');
    expect(restored.billableSeconds, 12);
    expect(restored.segments.single['sourceText'], 'hello');
  });

  test(
      'durable retry forwards the signed proof after process loss and clears only on ack',
      () async {
    final directory = await Directory.systemTemp.createTemp('formal-retry-');
    addTearDown(() => directory.delete(recursive: true));
    final file = File('${directory.path}/outbox.json');
    await FileRealtimeFinalizationOutbox(file: file)
        .upsert(task(proof: 'fixture-stop-proof', seconds: 0));
    var attempts = 0;
    final api = RealtimeApiClient(
        baseUrl: Uri.parse('https://fixture.invalid'),
        accountSessionStore: MemoryAccountSessionStore(const AccountSession(
            token: 'fixture', expiresAtIso: '2099-01-01T00:00:00Z')),
        client: MockClient((request) async {
          attempts++;
          expect(
              request.url.path, '/realtime/sessions/fixture-session/finalize');
          expect(jsonDecode(request.body),
              containsPair('gatewayReceipt', 'fixture-stop-proof'));
          return http.Response('{}', attempts == 1 ? 503 : 200);
        }));
    final outbox = FileRealtimeFinalizationOutbox(file: file);
    final repository = RealtimeRepository(
        apiClient: api,
        gatewayClient: RealtimeGatewayClient(),
        finalizationOutbox: outbox);
    addTearDown(repository.dispose);
    await expectLater(repository.recoverPendingFinalizations(),
        throwsA(isA<RealtimeApiException>()));
    expect((await outbox.load()).single.gatewayReceipt, 'fixture-stop-proof');
    await repository.recoverPendingFinalizations();
    expect(attempts, 2);
    expect(await outbox.load(), isEmpty);
  });

  test(
      'captures ended proof before notifying listeners using a process-owned loopback socket',
      () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    WebSocket? accepted;
    final requests = server.listen((request) async {
      accepted = await WebSocketTransformer.upgrade(request,
          protocolSelector: (protocols) => 'ai-phone.realtime.v1');
      accepted!.listen((message) {
        if ((jsonDecode(message as String) as Map)['type'] == 'session.end') {
          accepted!.add(jsonEncode({
            'type': 'session.ended',
            'sessionId': 'fixture-session',
            'billableSeconds': 12,
            'gatewayReceipt': 'fixture-stop-proof',
            'flush': {'status': 'completed'}
          }));
        }
      });
    });
    final gateway = RealtimeGatewayClient();
    addTearDown(() async {
      gateway.dispose();
      await accepted?.close();
      await requests.cancel();
      await server.close(force: true);
    });
    await gateway.connect(RealtimeSession(
        sessionId: 'fixture-session',
        realtimeToken: 'fixture-token',
        endpoint: Uri.parse('ws://127.0.0.1:${server.port}'),
        expiresAt: DateTime.utc(2099),
        maxDurationSeconds: 60));
    final ended =
        gateway.events.firstWhere((event) => event.type == 'session.ended');
    await gateway.endAndWait('fixture-session');
    expect((await ended).gatewayReceipt, 'fixture-stop-proof');
    expect(gateway.gatewayReceiptForSession('fixture-session'),
        'fixture-stop-proof');
    gateway.forgetGatewayReceipt('fixture-session');
    expect(gateway.gatewayReceiptForSession('fixture-session'), isNull);
    expect(
        GatewayRealtimeEvent.fromJson({'type': 'session.ended'}).gatewayReceipt,
        isNull);
  });
}

RealtimeFinalizationTask task({String? proof, int seconds = 0}) =>
    RealtimeFinalizationTask(
        sessionId: 'fixture-session',
        idempotencyKey: 'finalize:fixture-session',
        billableSeconds: seconds,
        segments: const [
          {'id': 'one', 'sourceText': 'hello', 'translatedText': '你好'}
        ],
        createdAt: DateTime.utc(2026, 10, 26),
        gatewayReceipt: proof);
