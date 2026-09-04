part of 'realtime_gateway_client.dart';

extension RealtimeGatewayControl on RealtimeGatewayClient {
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
    return events
        .where((event) =>
            event.type == type &&
            (event.sessionId == null || event.sessionId == sessionId))
        .timeout(timeout)
        .first
        .then((_) => true)
        .catchError((Object _) => false);
  }
}
