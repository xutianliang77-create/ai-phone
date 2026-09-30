import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';

// Existing Gateway control transport with a loopback-only ACK peer. No model,
// microphone, credentials, HTTP session creation, or TTS synthesis is used.
class VoiceWire {
  VoiceWire(
      {this.public = true, this.boundVoice = '101001', this.reject = false});
  final bool public, reject;
  final String boundVoice;
  final frames = <Map<String, dynamic>>[];
  final peer = Completer<WebSocket>();
  late HttpServer server;
  late StreamSubscription<HttpRequest> requests;
  late RealtimeGatewayClient gateway;
  late RealtimeRepository repository;
  int connections = 0, httpRequests = 0;
  bool enabled = true;

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    requests = server.listen((request) async {
      connections++;
      final socket = await WebSocketTransformer.upgrade(request,
          protocolSelector: (protocols) => protocols.first);
      peer.complete(socket);
      if (public) {
        socket.add(jsonEncode(
            {'type': 'session.started', 'sessionId': 'voice-session'}));
      }
      socket.listen((raw) {
        final event = jsonDecode(raw as String) as Map<String, dynamic>;
        frames.add(event);
        if (event['type'] != 'session.voice_output') return;
        // Same public voice boundary as createConfiguredPublicTtsOutputQueue:
        // an omitted preset retains the already-authorized voice.
        final accepted = !reject &&
            (!public ||
                !event.containsKey('presetId') ||
                event['presetId'] == boundVoice);
        if (accepted) enabled = event['enabled'] as bool;
        socket.add(jsonEncode({
          'type': 'session.voice_output.updated',
          'sessionId': event['sessionId'],
          'enabled': enabled,
          'accepted': accepted,
          if (!accepted) 'message': 'voice is not bound to this session',
        }));
      });
    });
    gateway = RealtimeGatewayClient();
    repository = RealtimeRepository(
      apiClient: RealtimeApiClient(
        baseUrl: Uri.parse('https://synthetic.invalid'),
        publicDeploymentId: public ? 'public-test' : '',
        accountSessionStore: MemoryAccountSessionStore(),
        client: MockClient((_) async {
          httpRequests++;
          throw StateError(
              'voice toggle must not create or requalify a session');
        }),
      ),
      gatewayClient: gateway,
    );
    await gateway.connect(RealtimeSession(
      sessionId: 'voice-session',
      realtimeToken: 'synthetic',
      endpoint: Uri.parse('ws://127.0.0.1:${server.port}/realtime'),
      expiresAt: DateTime.now().add(const Duration(minutes: 5)),
      syncBinding: public
          ? const ResultSyncBinding(
              deploymentId: 'public-test',
              ownerId: 'owner',
              modelPolicyRevision: 'policy')
          : null,
    ));
    await peer.future;
  }

  Future<void> close() async {
    await gateway.close();
    repository.dispose();
    if (peer.isCompleted) await (await peer.future).close();
    await requests.cancel();
    await server.close(force: true);
  }
}

void main() {
  for (final boundVoice in ['101001', 'Cherry', 'coral', 'en-US-Standard-C']) {
    test('public off/on retains the server-bound voice $boundVoice', () async {
      final wire = VoiceWire(boundVoice: boundVoice);
      await wire.start();
      addTearDown(wire.close);
      wire.repository.configureVoiceOutput('off');
      await wire.repository.setVoiceOutput('voice-session', false);
      await wire.repository
          .setVoiceOutput('voice-session', true, presetId: 'zh_female_natural');
      wire.repository.configureVoiceOutput('natural');
      expect(wire.enabled, isTrue);
      expect(wire.frames, [
        {
          'type': 'session.voice_output',
          'sessionId': 'voice-session',
          'enabled': false
        },
        {
          'type': 'session.voice_output',
          'sessionId': 'voice-session',
          'enabled': true
        },
      ]);
      expect(wire.connections, 1);
      expect(wire.httpRequests, 0);
    });
  }

  test('private 1.0 voice controls preserve the selected preset', () async {
    final wire = VoiceWire(public: false);
    await wire.start();
    addTearDown(wire.close);
    await wire.repository
        .setVoiceOutput('voice-session', true, presetId: 'zh_female_natural');
    expect(wire.frames.single['presetId'], 'zh_female_natural');
    expect(wire.enabled, isTrue);
    expect(wire.httpRequests, 0);
  });

  test('public rejection remains an error without reconnect or new HTTP',
      () async {
    final wire = VoiceWire(reject: true);
    await wire.start();
    addTearDown(wire.close);
    await expectLater(wire.repository.setVoiceOutput('voice-session', false),
        throwsA(isA<StateError>()));
    expect(wire.connections, 1);
    expect(wire.frames, hasLength(1));
    expect(wire.httpRequests, 0);
  });

  test('another session cannot receive a voice control', () async {
    final wire = VoiceWire();
    await wire.start();
    addTearDown(wire.close);
    await expectLater(wire.repository.setVoiceOutput('other-session', false),
        throwsA(isA<StateError>()));
    expect(wire.frames, isEmpty);
  });
}
