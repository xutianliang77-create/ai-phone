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
  final peers = <WebSocket>[];
  final _nextPeer = StreamController<WebSocket>.broadcast();
  final frames = <Map<String, dynamic>>[];
  int connections = 0;
  late RealtimeGatewayClient client;
  Future<void> setup({bool public = true, bool recoverySocketAssembly = false}) async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      connections++;
      final socket = await WebSocketTransformer.upgrade(request, protocolSelector: (values) => values.first);
      peers.add(socket);
      if (!peer.isCompleted) peer.complete(socket);
      _nextPeer.add(socket);
      socket.listen((message) => frames.add(jsonDecode(message as String) as Map<String, dynamic>));
    });
    client = RealtimeGatewayClient(publicStartTimeout: const Duration(milliseconds: 150),
      publicRecoverySocketAssembly: recoverySocketAssembly);
  }
  Future<WebSocket> nextPeer() => _nextPeer.stream.first;
  RealtimeSession session({bool public = true}) => RealtimeSession(sessionId: 'session', realtimeToken: 'synthetic', endpoint: Uri.parse('ws://127.0.0.1:${server.port}/realtime'),
    expiresAt: DateTime.now().add(const Duration(minutes: 5)), maxDurationSeconds: 60,
    syncBinding: public ? const ResultSyncBinding(deploymentId: 'public', ownerId: 'owner', modelPolicyRevision: 'policy') : null);
  Future<void> close() async {
    await client.close();client.dispose();for(final socket in peers){await socket.close();}await _nextPeer.close();await server.close(force: true);
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
  test('explicit public recovery echoes the trusted bridge and sends only the exact first new sequence', () async {
    final h = Wire();await h.setup(recoverySocketAssembly: true);addTearDown(h.close);
    final session=h.session(),connect=h.client.connect(session),first=await h.peer.future;
    first.add(jsonEncode({'type':'session.started','sessionId':'session'}));await connect;
    await first.close();await Future<void>.delayed(const Duration(milliseconds:20));
    final next=h.nextPeer(),recovery=h.client.reconnectAndResume('session'),second=await next;
    second.add(jsonEncode({'type':'session.started','sessionId':'session'}));
    second.add(jsonEncode({'type':'session.recovery.ready','sessionId':'session','lastAcceptedSample':1600,'nextSequence':5}));
    await _waitFor(() => h.frames.any((f) => f['type']=='session.resume'));
    final resume=h.frames.lastWhere((f)=>f['type']=='session.resume');
    expect(resume['recovery'],{'lastAcceptedSample':1600,'nextSequence':5});
    second.add(jsonEncode({'type':'session.resumed','sessionId':'session'}));expect(await recovery,true);
    expect(h.client.sendAudio('session',const AudioFrame(sequence:4,timestampMs:0,sampleRate:16000,bytes:[0,0])),false);
    expect(h.client.sendAudio('session',const AudioFrame(sequence:5,timestampMs:20,sampleRate:16000,bytes:[0,0])),true);
    await _waitFor(()=>h.frames.any((f)=>f['type']=='audio.frame'&&f['sequence']==5));
    expect(h.connections,2);
  });
  test('missing recovery bridge keeps explicit public reconnect closed and sends no audio', () async {
    final h=Wire();await h.setup(recoverySocketAssembly:true);addTearDown(h.close);
    final connect=h.client.connect(h.session()),first=await h.peer.future;first.add(jsonEncode({'type':'session.started','sessionId':'session'}));await connect;
    await first.close();await Future<void>.delayed(const Duration(milliseconds:20));
    final next=h.nextPeer(),recovery=h.client.reconnectAndResume('session'),second=await next;
    second.add(jsonEncode({'type':'session.started','sessionId':'session'}));
    expect(await recovery,false);expect(h.client.sendAudio('session',frame),false);expect(h.frames.where((f)=>f['type']=='session.resume'),isEmpty);
  });
  test('recovery rejection closes immediately and does not send another audio frame', () async {
    final h=Wire();await h.setup(recoverySocketAssembly:true);addTearDown(h.close);final events=<String>[];
    final subscription=h.client.events.listen((event)=>events.add(event.type));addTearDown(subscription.cancel);
    final connect=h.client.connect(h.session()),first=await h.peer.future;first.add(jsonEncode({'type':'session.started','sessionId':'session'}));await connect;
    await first.close();await Future<void>.delayed(const Duration(milliseconds:20));
    final next=h.nextPeer(),recovery=h.client.reconnectAndResume('session'),second=await next;
    second.add(jsonEncode({'type':'session.started','sessionId':'session'}));
    second.add(jsonEncode({'type':'session.recovery.ready','sessionId':'session','lastAcceptedSample':1600,'nextSequence':5}));
    await _waitFor(() => h.frames.any((f) => f['type']=='session.resume'));
    second.add(jsonEncode({'type':'error','sessionId':'session','code':'bad_event','stage':'session','retryable':false}));
    expect(await recovery,false);await Future<void>.delayed(const Duration(milliseconds:20));
    expect(events,containsAllInOrder(['error','connection.closed']));expect(h.client.sendAudio('session',frame),false);
    expect(h.frames.where((f)=>f['type']=='audio.frame'),isEmpty);expect(h.connections,2);
  });
  test('legacy private connect keeps its transport-only handshake', () async {
    final h = Wire();await h.setup(public: false);addTearDown(h.close);
    await h.client.connect(h.session(public: false));expect(h.client.sendAudio('session', frame), isTrue);
  });
}

Future<void> _waitFor(bool Function() ready) async {
  final deadline=DateTime.now().add(const Duration(seconds:1));
  while(!ready()){
    if(DateTime.now().isAfter(deadline))throw StateError('gateway test condition timed out');
    await Future<void>.delayed(const Duration(milliseconds:5));
  }
}
