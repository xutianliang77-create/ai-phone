import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';

class Wire {
  late HttpServer server;
  final peer = Completer<WebSocket>();
  final frames = <Map<String, dynamic>>[];
  int connections = 0;
  late RealtimeGatewayClient client;
  Future<void> setup({bool public = true}) async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      connections++;
      final socket = await WebSocketTransformer.upgrade(request, protocolSelector: (values) => values.first);
      if (!peer.isCompleted) peer.complete(socket);
      socket.listen((message) => frames.add(jsonDecode(message as String) as Map<String, dynamic>));
    });
    client = RealtimeGatewayClient(publicStartTimeout: const Duration(milliseconds: 150));
  }
  RealtimeSession session({bool public = true}) => RealtimeSession(sessionId: 'session', realtimeToken: 'synthetic', endpoint: Uri.parse('ws://127.0.0.1:${server.port}/realtime'),
    expiresAt: DateTime.now().add(const Duration(minutes: 5)), maxDurationSeconds: 60,
    syncBinding: public ? const ResultSyncBinding(deploymentId: 'public', ownerId: 'owner', modelPolicyRevision: 'policy') : null);
  Future<void> close() async {
    await client.close();client.dispose();if (peer.isCompleted) await (await peer.future).close();await server.close(force: true);
  }
}
const frame = AudioFrame(sequence: 1, timestampMs: 0, sampleRate: 16000, bytes: [0, 0]);
void main() {
  test('public transport handshake does not admit audio before matching session.started', () async {
    final h = Wire();await h.setup();addTearDown(h.close);bool ready = false;
    final connect = h.client.connect(h.session()).then((_) => ready = true), peer = await h.peer.future;
    await Future<void>.delayed(const Duration(milliseconds: 10));expect(ready, isFalse);expect(h.client.sendAudio('session', frame), isFalse);
    peer.add(jsonEncode({'type': 'session.started', 'sessionId': 'other'}));await Future<void>.delayed(const Duration(milliseconds: 10));expect(ready, isFalse);
    peer.add(jsonEncode({'type': 'session.started', 'sessionId': 'session'}));await connect;expect(h.client.sendAudio('session', frame), isTrue);
    await Future<void>.delayed(const Duration(milliseconds: 10));expect(h.frames, hasLength(1));
  });
  test('missing started acknowledgment fails and does not reconnect or replay', () async {
    final h = Wire();await h.setup();addTearDown(h.close);
    await expectLater(h.client.connect(h.session()), throwsA(isA<TimeoutException>()));
    expect(h.client.sendAudio('session', frame), isFalse);await Future<void>.delayed(const Duration(milliseconds: 300));expect(h.connections, 1);
  });
  test('close cancels a pending start without waiting for timeout', () async {
    final h = Wire();await h.setup();addTearDown(h.close);
    final connect = h.client.connect(h.session()), checked = expectLater(connect, throwsA(isA<StateError>()));await h.peer.future;
    await h.client.close();await checked;expect(h.client.sendAudio('session', frame), isFalse);
  });
  test('established public disconnect emits closed and never auto reconnects', () async {
    final h = Wire();await h.setup();addTearDown(h.close);final events = <String>[];final sub = h.client.events.listen((e) => events.add(e.type));addTearDown(sub.cancel);
    final connect = h.client.connect(h.session()), peer = await h.peer.future;peer.add(jsonEncode({'type': 'session.started', 'sessionId': 'session'}));await connect;
    await peer.close();await Future<void>.delayed(const Duration(milliseconds: 300));
    expect(events, contains('connection.closed'));expect(events, isNot(contains('connection.reconnecting')));expect(h.connections, 1);
    expect(await h.client.reconnectAndResume('session'), isFalse);
  });
  test('legacy private connect keeps its transport-only handshake', () async {
    final h = Wire();await h.setup(public: false);addTearDown(h.close);
    await h.client.connect(h.session(public: false));expect(h.client.sendAudio('session', frame), isTrue);
  });
}
