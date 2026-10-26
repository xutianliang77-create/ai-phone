part of 'realtime_gateway_client.dart';

extension _AccountScopedGateway on RealtimeGatewayClient {
  Future<void> _openAccountScoped(RealtimeSession session) async {
    await _accountOperation?.check();
    _transportReady = false;
    final generation = ++_connectionGeneration;
    final started = _accountOperation == null ? null : Completer<void>();
    _started = started;
    final wait = started?.future.timeout(RealtimeGatewayClient._controlTimeout);
    if (wait != null) unawaited(wait.catchError((Object _) {}));
    final channel = WebSocketChannel.connect(
      realtimeGatewayEndpoint(session),
      protocols: realtimeGatewayProtocols(session),
    );
    _channel = channel;
    _subscription = channel.stream.listen(
      (message) => _handleMessage(generation, message),
      onError: (Object error) => _handleDisconnect(generation, error),
      onDone: () => _handleDisconnect(generation),
    );
    try {
      await channel.ready.timeout(RealtimeGatewayClient._connectTimeout);
      if (wait != null) await wait;
      await _accountOperation?.check();
      if (generation != _connectionGeneration ||
          !identical(_channel, channel)) {
        throw StateError('Realtime connection closed before becoming ready');
      }
      _transportReady = true;
      _lastReconnectAudioDrain = _flushReconnectAudio(session.sessionId);
      _scheduleStableConnectionReset(generation);
      _watchAccountScope(generation);
    } finally {
      if (identical(_started, started)) _started = null;
    }
  }

  void _watchAccountScope(int generation) {
    _accountTimer?.cancel();
    if (_accountOperation == null) return;
    var checking = false;
    _accountTimer = Timer.periodic(const Duration(seconds: 1), (_) async {
      if (checking || generation != _connectionGeneration) return;
      checking = true;
      try {
        await _accountOperation!.check();
      } catch (_) {
        _accountTimer?.cancel();
        _transportReady = false;
        _events.add(
          const GatewayRealtimeEvent.connection(
            type: 'connection.closed',
            message: '账号状态已变化，会话已停止',
          ),
        );
        if (_session != null) {
          unawaited(endAndWait(_session!.sessionId).whenComplete(close));
        }
      } finally {
        checking = false;
      }
    });
  }
}
