part of 'realtime_gateway_client.dart';

extension _RealtimeGatewayTransportEvents on RealtimeGatewayClient {
  void _handleMessage(int generation, dynamic message) {
    if (generation != _connectionGeneration) return;
    if (message is! String) return;
    late final GatewayRealtimeEvent event;
    try {
      final json = jsonDecode(message) as Map<String, Object?>;
      event = GatewayRealtimeEvent.fromJson(json);
    } catch (_) {
      if (_session?.syncBinding != null) {
        _handleDisconnect(generation);
        return;
      }
      rethrow;
    }
    if (_session?.syncBinding != null) {
      final started = _publicStarted;
      if (event.sessionId != _session!.sessionId) {
        if (event.sessionId == null && event.type == 'error') _handleDisconnect(generation);
        return;
      }
      if (event.type == 'session.paused') _publicPaused = true;
      if (event.type == 'session.resumed') {
        _publicPaused = false;
        _suspended = false;
      }
      if (event.type == 'session.recovery.ready') {
        _publicRecovery.receive(
          event.recoveryLastAcceptedSample,
          event.recoveryNextSequence,
        );
      }
      if (event.type == 'error' && _publicRecovery.firstSequence != null) {
        _events.add(event);
        _publicRecovery.fail();
        _handleDisconnect(generation);
        return;
      }
      if (event.type == 'audio.output' && (_suspended || _publicPaused)) return;
      if (event.type == 'error' ||
          event.type == 'session.ended' && started?.isCompleted == false) {
        if (started != null && !started.isCompleted) {
          started.completeError(StateError('Public session was not confirmed'));
        }
      }
      if (event.type == 'session.started' &&
          started != null &&
          !started.isCompleted) {
        started.complete();
      }
    }
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
    if (_session?.syncBinding != null) {
      final started = _publicStarted;
      if (started != null && !started.isCompleted) {
        started.completeError(
            StateError('Public connection lost before session start'));
      }
      _manualClose = true;
      _reconnectAudioBuffer.clear();
      _events.add(const GatewayRealtimeEvent.connection(
          type: 'connection.closed', message: '公有连接已断开；未自动重连或重放音频'));
      return;
    }
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
