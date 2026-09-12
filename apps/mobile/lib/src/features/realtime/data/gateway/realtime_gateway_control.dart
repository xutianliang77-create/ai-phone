part of 'realtime_gateway_client.dart';

extension RealtimeGatewayControl on RealtimeGatewayClient {
  Future<bool> _commitAudioBoundary(String sessionId, Duration timeout) async {
    if (_session?.sessionId != sessionId ||
        _session?.syncBinding == null ||
        !_transportReady ||
        _lastAudioSequence < 0) {
      return false;
    }
    final generation = _connectionGeneration;
    final sequence = _lastAudioSequence;
    final response = Completer<GatewayRealtimeEvent>();
    final subscription = events.listen((event) {
      if (event.sessionId == sessionId &&
          event.sequence == sequence &&
          (event.type == 'audio.boundary.committed' ||
              event.type == 'audio.boundary.rejected') &&
          !response.isCompleted) {
        response.complete(event);
      }
    });
    try {
      if (!_send({
        'type': 'audio.boundary',
        'sessionId': sessionId,
        'sequence': sequence
      })) {
        return false;
      }
      final ack = await response.future.timeout(timeout);
      return generation == _connectionGeneration &&
          _session?.sessionId == sessionId &&
          ack.type == 'audio.boundary.committed';
    } catch (_) {
      return false;
    } finally {
      await subscription.cancel();
    }
  }

  Future<void> _setVoiceOutput(String sessionId, bool enabled,
      {String? presetId}) async {
    if (_session?.sessionId != sessionId || !_transportReady) {
      throw StateError('实时连接尚未就绪，无法设置语音播报');
    }
    final response = Completer<GatewayRealtimeEvent>();
    final subscription = events.listen((event) {
      if (event.type == 'session.voice_output.updated' &&
          event.sessionId == sessionId &&
          !response.isCompleted) {
        response.complete(event);
      }
    });
    try {
      if (!_send({
        'type': 'session.voice_output',
        'sessionId': sessionId,
        'enabled': enabled,
        if (presetId != null) 'presetId': presetId
      })) {
        throw StateError('语音播报设置发送失败');
      }
      final ack =
          await response.future.timeout(RealtimeGatewayClient._controlTimeout);
      if (ack.voiceOutputAccepted != true ||
          ack.voiceOutputEnabled != enabled) {
        throw StateError(ack.message ?? '服务器未确认语音播报设置');
      }
    } finally {
      await subscription.cancel();
    }
  }

  Future<bool> _waitForSessionEvent(
    String type,
    String sessionId,
    Duration timeout,
  ) {
    final response = Completer<bool>();
    late final StreamSubscription<GatewayRealtimeEvent> subscription;
    subscription = events.listen((event) {
      final sessionMatches = event.sessionId == null || event.sessionId == sessionId;
      if (!sessionMatches || response.isCompleted) return;
      if (event.type == type) response.complete(true);
      if (event.type == 'error' || event.type == 'connection.closed') {
        response.complete(false);
      }
    }, onError: (Object _) {
      if (!response.isCompleted) response.complete(false);
    }, onDone: () {
      if (!response.isCompleted) response.complete(false);
    });
    return response.future.timeout(timeout, onTimeout: () => false).whenComplete(
          subscription.cancel,
        );
  }
}
