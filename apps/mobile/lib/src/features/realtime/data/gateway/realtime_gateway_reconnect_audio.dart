part of 'realtime_gateway_client.dart';

extension _RealtimeGatewayReconnectAudio on RealtimeGatewayClient {
  bool _shouldBufferReconnectAudio(String sessionId) {
    return _session?.syncBinding == null &&
        _reconnectAttempts > 0 &&
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
