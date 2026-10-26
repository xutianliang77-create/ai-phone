part of 'realtime_gateway_client.dart';

extension _GatewayReconnect on RealtimeGatewayClient {
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
    if (_started != null && !_started!.isCompleted) {
      _started!.completeError(StateError('session_connection_closed'));
    }
    if (_manualClose || _suspended) return;
    if (_reconnectTimer?.isActive ?? false) return;
    if (_reconnectAttempts >= _reconnectBackoff.maxAttempts) {
      _events.add(
        const GatewayRealtimeEvent.connection(
          type: 'connection.closed',
          message: 'Realtime connection lost',
        ),
      );
      return;
    }

    _reconnectAttempts += 1;
    _events.add(
      GatewayRealtimeEvent.connection(
        type: 'connection.reconnecting',
        message:
            'Reconnecting ($_reconnectAttempts/${_reconnectBackoff.maxAttempts})',
      ),
    );
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
        _events.add(
          GatewayRealtimeEvent.connection(
            type: 'connection.reconnected',
            message: 'Realtime connection restored',
            replayedAudioMs: _lastReconnectAudioDrain.replayedAudioMs,
            droppedAudioMs: _lastReconnectAudioDrain.droppedAudioMs,
          ),
        );
      } catch (_) {
        _handleDisconnect(_connectionGeneration);
      }
    });
  }

  void _scheduleStableConnectionReset(int generation) {
    _stableConnectionTimer?.cancel();
    _stableConnectionTimer = Timer(
      _reconnectBackoff.stableConnectionPeriod,
      () {
        if (generation != _connectionGeneration ||
            _channel == null ||
            _manualClose ||
            _suspended) {
          return;
        }
        _reconnectAttempts = 0;
      },
    );
  }

  Future<void> _closeTransport() async {
    _connectionGeneration += 1;
    _stableConnectionTimer?.cancel();
    _transportReady = false;
    final subscription = _subscription;
    final channel = _channel;
    _subscription = null;
    _channel = null;
    await subscription?.cancel();
    await channel?.sink.close();
  }

  bool _shouldBufferReconnectAudio(String sessionId) {
    return _reconnectAttempts > 0 &&
        _session?.sessionId == sessionId &&
        !_manualClose &&
        !_suspended;
  }

  RealtimeReconnectAudioDrain _flushReconnectAudio(String sessionId) {
    final drain = _reconnectAudioBuffer.drain();
    for (final frame in drain.frames) {
      _sendAudioFrame(sessionId, frame);
    }
    return drain;
  }
}
