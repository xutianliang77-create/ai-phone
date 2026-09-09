import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'public_gateway_start_test.dart' as wire;
import 'public_session_lifecycle_test.dart' as lifecycle;

Future<void> until(bool Function() ready) async {
  final deadline=DateTime.now().add(const Duration(seconds:2));
  while(!ready()) {
    if(DateTime.now().isAfter(deadline)) throw StateError('Loopback condition timed out');
    await Future<void>.delayed(const Duration(milliseconds:5));
  }
}
void event(WebSocket peer,String type,{String id='session'}) =>
  peer.add(jsonEncode({'type':type,'sessionId':id}));
Future<WebSocket> connected(wire.Wire h) async {
  final starting=h.client.connect(h.session()),peer=await h.peer.future;
  event(peer,'session.started');await starting;return peer;
}
Future<void> paused(wire.Wire h,WebSocket peer) async {
  final pause=h.client.pauseAndWait('session');
  await until(()=>h.frames.any((f)=>f['type']=='session.pause'));
  event(peer,'session.paused');expect(await pause,true);
}

void main() {
  test('confirmed public pause retains the same socket across lifecycle and blocks audio until resume ACK',() async {
    final h=wire.Wire();await h.setup();addTearDown(h.close);
    final peer=await connected(h);await paused(h,peer);
    await h.client.suspendForLifecycle();expect(peer.readyState,WebSocket.open);
    expect(h.client.sendAudio('session',wire.frame),false);
    final received=<String>[];final sub=h.client.events.listen((e)=>received.add(e.type));addTearDown(sub.cancel);
    event(peer,'audio.output');await Future<void>.delayed(const Duration(milliseconds:10));expect(received, isNot(contains('audio.output')));
    final resume=h.client.resumeAndWait('session',timeout:const Duration(milliseconds:200));
    await until(()=>h.frames.any((f)=>f['type']=='session.resume'));
    event(peer,'session.resumed',id:'other');await Future<void>.delayed(const Duration(milliseconds:10));
    expect(h.client.sendAudio('session',wire.frame),false);
    event(peer,'session.resumed');expect(await resume,true);
    expect(h.client.sendAudio('session',wire.frame),true);await until(()=>h.frames.any((f)=>f['type']=='audio.frame'));
    expect(h.frames.where((f)=>f['type']=='audio.frame'),hasLength(1));expect(h.connections,1);
  });
  test('pause without server ACK is not eligible for retaining public transport',() async {
    final h=wire.Wire();await h.setup();addTearDown(h.close);final peer=await connected(h);
    await h.client.suspendForLifecycle();await until(()=>peer.readyState==WebSocket.closed);
    expect(h.client.sendAudio('session',wire.frame),false);expect(h.connections,1);
  });
  test('actual background disconnect does not reconnect or replay',() async {
    final h=wire.Wire();await h.setup();addTearDown(h.close);final peer=await connected(h);await paused(h,peer);
    await h.client.suspendForLifecycle();await peer.close();await Future<void>.delayed(const Duration(milliseconds:30));
    expect(await h.client.reconnectAndResume('session'),false);expect(h.client.sendAudio('session',wire.frame),false);expect(h.connections,1);
  });
  test('missing resume ACK keeps audio blocked; explicit close cannot revive the retained transport',() async {
    final h=wire.Wire();await h.setup();addTearDown(h.close);final peer=await connected(h);await paused(h,peer);
    await h.client.suspendForLifecycle();
    expect(await h.client.resumeAndWait('session',timeout:const Duration(milliseconds:30)),false);
    expect(h.client.sendAudio('session',wire.frame),false);
    await h.client.close();expect(h.client.canResumePublicTransport('session'),false);
    expect(h.client.sendAudio('session',wire.frame),false);expect(h.connections,1);
  });
  test('private lifecycle still closes its transport using the original path',() async {
    final h=wire.Wire();await h.setup(public:false);addTearDown(h.close);
    await h.client.connect(h.session(public:false));final peer=await h.peer.future;
    await h.client.suspendForLifecycle();await until(()=>peer.readyState==WebSocket.closed);
    expect(h.client.canResumePublicTransport('session'),false);
  });
  test('repository resumes retained public connection only after current server permission',() async {
    final h=wire.Wire();await h.setup();addTearDown(h.close);
    final data=lifecycle.Harness();addTearDown(data.close);
    final api=lifecycle.Api(MockClient(data.handle),data.accounts)..returnedSession=RealtimeSession(
      sessionId:'public-s',realtimeToken:'synthetic',endpoint:h.session().endpoint,
      expiresAt:DateTime.now().subtract(const Duration(seconds:1)),maxDurationSeconds:60,
      syncBinding:lifecycle.session.syncBinding);
    final repo=RealtimeRepository(apiClient:api,gatewayClient:h.client,resultSyncStore:data.store);addTearDown(repo.dispose);
    final start=repo.startSession(),peer=await h.peer.future;event(peer,'session.started',id:'public-s');await start;
    final pause=repo.pauseAndWait('public-s');await until(()=>h.frames.any((f)=>f['type']=='session.pause'));
    event(peer,'session.paused',id:'public-s');expect(await pause,true);await repo.suspendForLifecycle();
    data.resume=false;expect(await repo.resumeAfterLifecycle('public-s'),false);
    expect(h.frames.where((f)=>f['type']=='session.resume'),isEmpty);
    data.resume=true;final resumed=repo.resumeAfterLifecycle('public-s');
    await until(()=>h.frames.any((f)=>f['type']=='session.resume'));
    event(peer,'session.resumed',id:'public-s');expect(await resumed,true);
    expect(h.connections,1);expect(data.posts,isEmpty);
    await repo.closeRealtime();expect(await repo.resumeAfterLifecycle('public-s'),false);expect(h.connections,1);
  });
}
