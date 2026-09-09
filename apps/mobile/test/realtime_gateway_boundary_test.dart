import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';

Future<(RealtimeGatewayClient, List<Map<String, dynamic>>)> fixture(
    void Function(WebSocket, Map<String, dynamic>) reply,
    {bool public = true}) async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  final connected = Completer<WebSocket>();
  final received = <Map<String, dynamic>>[];
  final requests = server.listen((request) async {
    final socket = await WebSocketTransformer.upgrade(request,
        protocolSelector: (values) => values.first);
    connected.complete(socket);
    if (public) {
      socket.add(jsonEncode(
          {'type': 'session.started', 'sessionId': 'boundary-session'}));
    }
    socket.listen((raw) {
      final event = jsonDecode(raw as String) as Map<String, dynamic>;
      received.add(event);
      reply(socket, event);
    });
  });
  final client = RealtimeGatewayClient();
  addTearDown(() async {
    await client.close();
    client.dispose();
    if (connected.isCompleted) await (await connected.future).close();
    await requests.cancel();
    await server.close(force: true);
  });
  await client.connect(RealtimeSession(
      sessionId: 'boundary-session',
      realtimeToken: 'synthetic',
      endpoint: Uri.parse('ws://127.0.0.1:${server.port}/realtime'),
      expiresAt: DateTime.now().add(const Duration(hours: 1)),
      maxDurationSeconds: 60,
      syncBinding: public
          ? const ResultSyncBinding(
              deploymentId: 'public',
              ownerId: 'owner',
              modelPolicyRevision: 'p')
          : null));
  await connected.future;
  return (client, received);
}

const audio = AudioFrame(
    sequence: 7,
    timestampMs: 1788883200000,
    sampleRate: 24000,
    bytes: [0, 0, 0, 0]);
void main() {
  test('sends a public boundary for the last sent audio and matches exact ACK',
      () async {
    final (client, received) = await fixture((socket, event) {
      if (event['type'] != 'audio.boundary') return;
      socket.add(jsonEncode({
        'type': 'audio.boundary.committed',
        'sessionId': 'wrong',
        'sequence': 7
      }));
      socket.add(jsonEncode({
        'type': 'audio.boundary.committed',
        'sessionId': event['sessionId'],
        'sequence': event['sequence']
      }));
    });
    expect(client.sendAudio('boundary-session', audio), isTrue);
    expect(await client.commitAudioBoundaryAndWait('boundary-session'), isTrue);
    expect(received.map((e) => e['type']), ['audio.frame', 'audio.boundary']);
    expect(received.last, {
      'type': 'audio.boundary',
      'sessionId': 'boundary-session',
      'sequence': 7
    });
  });
  test('does not send boundaries without public binding or prior audio',
      () async {
    final (client, received) = await fixture((_, __) {}, public: false);
    client.sendAudio('boundary-session', audio);
    expect(
        await client.commitAudioBoundaryAndWait('boundary-session'), isFalse);
    expect(received.where((e) => e['type'] == 'audio.boundary'), isEmpty);
  });
  test('does not send for another session or before any audio', () async {
    final (client, received) = await fixture((_, __) {});
    expect(
        await client.commitAudioBoundaryAndWait('boundary-session'), isFalse);
    client.sendAudio('boundary-session', audio);
    expect(await client.commitAudioBoundaryAndWait('other'), isFalse);
    expect(received.where((e) => e['type'] == 'audio.boundary'), isEmpty);
  });
  test('explicit rejection returns false without retry', () async {
    final (client, received) = await fixture((socket, event) {
      if (event['type'] == 'audio.boundary') {
        socket.add(jsonEncode({
          'type': 'audio.boundary.rejected',
          'sessionId': event['sessionId'],
          'sequence': event['sequence']
        }));
      }
    });
    client.sendAudio('boundary-session', audio);
    expect(
        await client.commitAudioBoundaryAndWait('boundary-session'), isFalse);
    expect(received.where((e) => e['type'] == 'audio.boundary'), hasLength(1));
  });
  test('wrong sequence times out rather than acknowledging another boundary',
      () async {
    final (client, received) = await fixture((socket, event) {
      if (event['type'] == 'audio.boundary') {
        socket.add(jsonEncode({
          'type': 'audio.boundary.committed',
          'sessionId': event['sessionId'],
          'sequence': 8
        }));
      }
    });
    client.sendAudio('boundary-session', audio);
    expect(
        await client.commitAudioBoundaryAndWait('boundary-session',
            timeout: const Duration(milliseconds: 80)),
        isFalse);
    expect(received.where((e) => e['type'] == 'audio.boundary'), hasLength(1));
  });
  test(
      'boundary parser refuses fractional sequence and preserves ordinary partials',
      () {
    expect(
        () => GatewayRealtimeEvent.fromJson({
              'type': 'audio.boundary.committed',
              'sessionId': 's',
              'sequence': 1.5
            }),
        throwsFormatException);
    final partial = GatewayRealtimeEvent.fromJson({
      'type': 'transcript.partial',
      'sessionId': 's',
      'segmentId': 'turn',
      'revision': 0,
      'text': 'Bonjour'
    });
    expect(partial.text, 'Bonjour');
    expect(partial.revision, 0);
  });
}
