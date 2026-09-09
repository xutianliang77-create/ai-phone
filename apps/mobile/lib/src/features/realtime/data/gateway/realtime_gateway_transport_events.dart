part of 'realtime_gateway_client.dart';

extension _RealtimeGatewayTransportEvents on RealtimeGatewayClient {
  void _handleMessage(int generation, dynamic message) {
    if (generation != _connectionGeneration) return;
    if (message is! String) return;
    final json = jsonDecode(message) as Map<String, Object?>;
    final event = GatewayRealtimeEvent.fromJson(json);
    if (event.type == 'session.ended') {
      _manualClose = true;
      _reconnectTimer?.cancel();
      _stableConnectionTimer?.cancel();
      _reconnectAudioBuffer.clear();
    }
    _events.add(event);
  }

  void _handleDisconnect(int generation, [Object? error]) {
    if (generation != _connectionGeneration) return;
    final subscription = _subscription;
    final channel = _channel;
    _transportReady = false;
    _channel = null;
    _subscription = null;
    unawaited(subscription?.cancel());
    unawaited(channel?.sink.close());
    _stableConnectionTimer?.cancel();
    if (_manualClose || _suspended) return;
    if (_reconnectTimer?.isActive ?? false) return;
    if (_reconnectAttempts >= _reconnectBackoff.maxAttempts) {
      _events.add(const GatewayRealtimeEvent.connection(
        type: 'connection.closed',
        message: 'Realtime connection lost',
      ));
      return;
    }

    _reconnectAttempts += 1;
    _events.add(GatewayRealtimeEvent.connection(
      type: 'connection.reconnecting',
      message:
          'Reconnecting ($_reconnectAttempts/${_reconnectBackoff.maxAttempts})',
    ));
    _reconnectTimer?.cancel();
    final delay = _reconnectBackoff.delayForAttempt(
      _reconnectAttempts,
      jitterUnit: _reconnectJitterUnit(),
    );
    _reconnectTimer = Timer(delay, () async {
      final session = _session;
      if (session == null || _manualClose || _suspended) return;
      try {
        await _open(session);
        _events.add(GatewayRealtimeEvent.connection(
          type: 'connection.reconnected',
          message: 'Realtime connection restored',
          replayedAudioMs: _lastReconnectAudioDrain.replayedAudioMs,
          droppedAudioMs: _lastReconnectAudioDrain.droppedAudioMs,
        ));
      } catch (_) {
        _handleDisconnect(_connectionGeneration);
      }
    });
  }

}
