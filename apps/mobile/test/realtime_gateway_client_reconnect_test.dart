import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_reconnect_backoff.dart';

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
    final reconnected = client.events
        .firstWhere((event) => event.type == 'connection.reconnected');

    await server.acceptedSockets.single.close();
    await reconnected.timeout(const Duration(seconds: 2));
    await server.waitForAcceptedConnections(2);

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
  });
}

class _ReconnectWebSocketServer {
  _ReconnectWebSocketServer._(this._server, this._requests);

  final HttpServer _server;
  final StreamSubscription<HttpRequest> _requests;
  final List<WebSocket> acceptedSockets = <WebSocket>[];
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
    for (final waiter in _connectionWaiters) {
      if (!waiter.isCompleted) waiter.complete();
    }
    _connectionWaiters.clear();
  }
}
