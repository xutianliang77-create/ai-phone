import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';

void main() {
  test(
    '101 alone does not permit audio; account invalidation stops an admitted local connection',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0),
          ready = Completer<WebSocket>();
      final sub = server.listen((r) async {
        ready.complete(await WebSocketTransformer.upgrade(r));
      });
      final store = MemoryAccountSessionStore(
        AccountSession(
          token: 'synthetic',
          expiresAtIso: DateTime.now()
              .add(const Duration(days: 1))
              .toIso8601String(),
          ownerId: 'fixture',
          deploymentId: 'test',
          issuerOrigin: 'https://publisher.cn',
        ),
      );
      final gateway = RealtimeGatewayClient(accountStore: store),
          closed = gateway.events.firstWhere(
            (e) => e.type == 'connection.closed',
          );
      final session = RealtimeSession(
        sessionId: 'fixture-session',
        realtimeToken: 'synthetic',
        endpoint: Uri.parse('ws://127.0.0.1:${server.port}'),
        expiresAt: DateTime.now().add(const Duration(minutes: 5)),
        maxDurationSeconds: 300,
      );
      var done = false;
      final connecting = gateway.connect(session).then((_) => done = true);
      final socket = await ready.future;
      final listener = socket.listen((message) {
        final r = jsonDecode(message as String) as Map;
        if (r['type'] == 'session.end') {
          socket.add(
            jsonEncode({
              'type': 'session.ended',
              'sessionId': session.sessionId,
            }),
          );
        }
      });
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(done, isFalse);
      const audio = AudioFrame(
        bytes: [0, 0],
        sequence: 1,
        timestampMs: 0,
        sampleRate: 16000,
      );
      expect(gateway.sendAudio(session.sessionId, audio), isFalse);
      socket.add(
        jsonEncode({'type': 'session.started', 'sessionId': session.sessionId}),
      );
      await connecting;
      expect(gateway.sendAudio(session.sessionId, audio), isTrue);
      await store.clear();
      await closed.timeout(const Duration(seconds: 3));
      expect(gateway.sendAudio(session.sessionId, audio), isFalse);
      await gateway.close();
      gateway.dispose();
      await listener.cancel();
      await socket.close();
      await sub.cancel();
      await server.close(force: true);
    },
  );
}
