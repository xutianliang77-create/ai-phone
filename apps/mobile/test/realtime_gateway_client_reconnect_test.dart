import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_reconnect_backoff.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';

void main() {
  test('reconnects the same session after three transient handshake failures',
      () async {
    final server = await _ReconnectWebSocketServer.start();
    addTearDown(server.close);
    final client = RealtimeGatewayClient(
      reconnectBackoff: const RealtimeReconnectBackoff(
        maxAttempts: 5,
        initialDelay: Duration(milliseconds: 10),
        maxDelay: Duration(milliseconds: 40),
        jitterRatio: 0,
        stableConnectionPeriod: Duration(seconds: 1),
      ),
      reconnectJitterUnit: () => 0.5,
    );
    addTearDown(client.dispose);
    final events = <GatewayRealtimeEvent>[];
    final subscription = client.events.listen(events.add);
    addTearDown(subscription.cancel);
    final session = RealtimeSession(
      sessionId: 'session-reconnect',
      realtimeToken: 'token-reconnect',
      endpoint: server.endpoint,
      expiresAt: DateTime.utc(2026, 8, 28, 8),
      maxDurationSeconds: 60,
    );

    await client.connect(session);
    await server.waitForAcceptedConnections(1);
    server.rejectNextConnections(3);
    final reconnecting = client.events
        .firstWhere((event) => event.type == 'connection.reconnecting');
    final reconnected = client.events
        .firstWhere((event) => event.type == 'connection.reconnected');

    await server.acceptedSockets.single.close();
    await reconnecting.timeout(const Duration(seconds: 2));
    for (var sequence = 1; sequence <= 40; sequence += 1) {
      expect(
          client.sendAudio('session-reconnect', audioFrame(sequence)), isTrue);
    }
    final recovery = await reconnected.timeout(const Duration(seconds: 2));
    await server.waitForAcceptedConnections(2);
    await server.waitForReceivedMessages(connectionIndex: 1, count: 24);

    expect(server.rejectedConnections, 3);
    expect(server.acceptedSockets, hasLength(2));
    expect(
      events.where((event) => event.type == 'connection.closed'),
      isEmpty,
    );
    expect(
      events.where((event) => event.type == 'connection.reconnecting').length,
      4,
    );
    expect(
      server.requestedProtocols,
      everyElement(contains('ai-phone.token.token-reconnect')),
    );
    final replayed = server.receivedMessagesByConnection[1]
        .map((message) => jsonDecode(message) as Map<String, Object?>)
        .toList(growable: false);
    expect(replayed.map((message) => message['sequence']),
        List<int>.generate(24, (index) => index + 17));
    expect(recovery.replayedAudioMs, 2400);
    expect(recovery.droppedAudioMs, 1600);
  });
}

AudioFrame audioFrame(int sequence) {
  return AudioFrame(
    sequence: sequence,
    timestampMs: sequence * 100,
    sampleRate: 24000,
    bytes: List<int>.filled(4800, 0),
  );
}

class _ReconnectWebSocketServer {
  _ReconnectWebSocketServer._(this._server, this._requests);

  final HttpServer _server;
  final StreamSubscription<HttpRequest> _requests;
  final List<WebSocket> acceptedSockets = <WebSocket>[];
  final List<List<String>> receivedMessagesByConnection = <List<String>>[];
  final List<String> requestedProtocols = <String>[];
  final List<Completer<void>> _connectionWaiters = <Completer<void>>[];
  int rejectedConnections = 0;
  int _remainingRejectedConnections = 0;

  Uri get endpoint =>
      Uri.parse('ws://${_server.address.address}:${_server.port}/realtime');

  static Future<_ReconnectWebSocketServer> start() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    late _ReconnectWebSocketServer fixture;
    final requests = server.listen((request) {
      unawaited(fixture._handleRequest(request));
    });
    fixture = _ReconnectWebSocketServer._(server, requests);
    return fixture;
  }

  void rejectNextConnections(int count) {
    _remainingRejectedConnections = count;
  }

  Future<void> waitForAcceptedConnections(int count) async {
    if (acceptedSockets.length >= count) return;
    final completer = Completer<void>();
    _connectionWaiters.add(completer);
    await completer.future.timeout(const Duration(seconds: 2));
    if (acceptedSockets.length < count) {
      await waitForAcceptedConnections(count);
    }
  }

  Future<void> waitForReceivedMessages({
    required int connectionIndex,
    required int count,
  }) async {
    final deadline = DateTime.now().add(const Duration(seconds: 2));
    while (receivedMessagesByConnection.length <= connectionIndex ||
        receivedMessagesByConnection[connectionIndex].length < count) {
      if (DateTime.now().isAfter(deadline)) {
        throw TimeoutException('Timed out waiting for replayed audio');
      }
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
  }

  Future<void> close() async {
    await _requests.cancel();
    for (final socket in acceptedSockets) {
      await socket.close();
    }
    await _server.close(force: true);
  }

  Future<void> _handleRequest(HttpRequest request) async {
    requestedProtocols.add(
      request.headers.value('sec-websocket-protocol') ?? '',
    );
    if (_remainingRejectedConnections > 0) {
      _remainingRejectedConnections -= 1;
      rejectedConnections += 1;
      request.response.statusCode = HttpStatus.serviceUnavailable;
      await request.response.close();
      return;
    }
    final socket = await WebSocketTransformer.upgrade(
      request,
      protocolSelector: (protocols) =>
          protocols.isEmpty ? null : protocols.first,
    );
    acceptedSockets.add(socket);
    final received = <String>[];
    receivedMessagesByConnection.add(received);
    socket.listen((message) {
      if (message is String) received.add(message);
    });
    for (final waiter in _connectionWaiters) {
      if (!waiter.isCompleted) waiter.complete();
    }
    _connectionWaiters.clear();
  }
}
