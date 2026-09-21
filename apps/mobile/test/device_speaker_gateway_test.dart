import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';
import 'package:translation_mobile/src/platform/audio/device_speaker_diarizer.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';

class Speaker implements DeviceSpeakerDiarizer {
  final output = StreamController<Map<String, Object?>>.broadcast(sync: true);
  final frames = <(int, List<int>)>[];
  bool fail = false;
  int starts = 0, cancels = 0;
  Completer<List<Map<String, Object?>>>? ending;
  @override Stream<Map<String, Object?>> get events => output.stream;
  @override Future<bool> prepare() async => true;
  @override Future<void> start(String id, int rate) async { starts++; expect(rate, 16000); }
  @override Future<void> accept(String id, int start, List<int> pcm) async {
    if (fail) throw StateError('synthetic inference failure');
    frames.add((start, List.of(pcm)));
  }
  @override Future<List<Map<String, Object?>>> finish(String id) async => ending == null ? [] : ending!.future;
  @override Future<void> cancel(String id) async { cancels++; }
}
Map<String, Object?> evidence({String id='session', int sequence=1, int through=2}) => {
  'type':'speaker.evidence','sessionId':id,'profile':deviceSpeakerProfile,'modelRevision':deviceSpeakerRevision,
  'sequence':sequence,'sampleRate':16000,'throughSample':through,'spans':<Object?>[]};
class Wire {
  final speaker = Speaker();
  late HttpServer server;
  WebSocket? peer;
  final frames = <Map<String, dynamic>>[];
  late final client = RealtimeGatewayClient(deviceSpeaker:speaker);
  Future<void> start({bool enabled=true}) async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4,0);
    server.listen((request) async {
      final socket = peer = await WebSocketTransformer.upgrade(request,protocolSelector:(v)=>v.first);
      socket.listen((raw) {
        final frame=jsonDecode(raw as String) as Map<String,dynamic>; frames.add(frame);
        if(frame['type']=='session.pause') socket.add(jsonEncode({'type':'session.paused','sessionId':'session'}));
        if(frame['type']=='session.resume') socket.add(jsonEncode({'type':'session.resumed','sessionId':'session'}));
      });
      socket.add(jsonEncode({'type':'session.started','sessionId':'session'}));
    });
    await client.connect(RealtimeSession(sessionId:'session',realtimeToken:'synthetic',
      endpoint:Uri.parse('ws://127.0.0.1:${server.port}/realtime'),expiresAt:DateTime.now().add(const Duration(hours:1)),
      deviceSpeakerProfile:enabled ? deviceSpeakerProfile : null,
      syncBinding:const ResultSyncBinding(deploymentId:'public',ownerId:'owner',modelPolicyRevision:'policy',captureSampleRate:16000)));
  }
  bool audio(int seq) => client.sendAudio('session',AudioFrame(sequence:seq,timestampMs:seq*20,sampleRate:16000,bytes:const [1,0,2,0]));
  Future<void> close() async { await client.close(); await peer?.close(); await server.close(force:true); await speaker.output.close();client.dispose(); }
}
Future<void> tick() => Future<void>.delayed(const Duration(milliseconds:15));
void main() {
  test('only transmitted PCM enters local model; pause retains uploaded sample clock',() async {
    final w=Wire(); await w.start();addTearDown(w.close);
    expect(w.audio(1),isTrue);await tick();expect(w.speaker.frames.single.$1,0);expect(w.speaker.frames.single.$2,[1,0,2,0]);
    expect(await w.client.pauseAndWait('session'),isTrue);expect(w.audio(2),isFalse);
    expect(await w.client.resumeAndWait('session'),isTrue);expect(w.audio(3),isTrue);await tick();
    expect(w.speaker.frames.last.$1,2);expect(w.speaker.starts,1);
  });
  test('rejects foreign, future and duplicate evidence while preserving audio upload',() async {
    final w=Wire();await w.start();addTearDown(w.close);w.audio(1);
    w.speaker.output.add(evidence(id:'other'));w.speaker.output.add(evidence(through:3));
    w.speaker.output.add(evidence());w.speaker.output.add(evidence());await tick();
    expect(w.frames.where((e)=>e['type']=='speaker.evidence'),hasLength(1));
    expect(w.frames.where((e)=>e['type']=='audio.frame'),hasLength(1));
  });
  test('normal stop sends final metadata before session.end without changing text or billing',() async {
    final w=Wire();await w.start();addTearDown(w.close);w.audio(1);w.speaker.ending=Completer();
    final ending=w.client.endAndWait('session',timeout:const Duration(milliseconds:80));await tick();
    expect(w.frames.any((e)=>e['type']=='session.end'),isFalse);
    w.speaker.ending!.complete([evidence()]);await ending;await tick();
    expect(w.frames.map((e)=>e['type']).toList(),['audio.frame','speaker.evidence','session.end']);
  });
  test('local inference failure is nonfatal and later ASR audio still uploads',() async {
    final w=Wire();await w.start();addTearDown(w.close);final events=<String>[];
    final sub=w.client.events.listen((e)=>events.add(e.type));addTearDown(sub.cancel);
    w.speaker.fail=true;expect(w.audio(1),isTrue);await tick();expect(w.audio(2),isTrue);await tick();
    expect(events,contains('speaker.unavailable'));expect(events, isNot(contains('connection.closed')));
    expect(w.frames.where((e)=>e['type']=='audio.frame'),hasLength(2));
  });
  test('old off profile never initializes or feeds a local speaker model',() async {
    final w=Wire();await w.start(enabled:false);addTearDown(w.close);w.audio(1);await tick();
    expect(w.speaker.starts,0);expect(w.speaker.frames,isEmpty);
  });
}
